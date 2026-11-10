/**
 * Rebuilds an editable document from a PDF text layer.
 *
 * PDF files exported from Word/Excel draw table borders as thin filled
 * rectangles or stroked lines. Those rulings are the most reliable table
 * signal, so tables are reconstructed from them first (including merged cells);
 * text alignment is only a fallback for borderless forms.
 *
 * This file has no dependency on PDF.js or the DOM: the browser adapter passes
 * plain data, which keeps the layout logic testable in Node.
 */

import { compactRuns, isDarkColor, isNearWhite, isPureWhite, rectUnion } from "./document-model";
import type { DocumentBlock, ImageBlock, PageContent, ParagraphBlock, Rect, TableBlock, TableCellModel, TextRunModel } from "./document-model";

/** A PDF.js text item reduced to what the layout needs (PDF user space, y up). */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  hasEol: boolean;
  bold?: boolean;
  italic?: boolean;
  /** Family name derived from the embedded font ("Calibri"). */
  fontFamily?: string;
  /** Hex colour without '#' when known. */
  color?: string;
}

/**
 * Font style and family from an embedded PDF font name such as
 * "BCDEEE+Calibri-Bold" or "TimesNewRomanPS-BoldItalicMT".
 */
export function describePdfFont(postScriptName: string) {
  const name = postScriptName.replace(/^[A-Z]{6}\+/, "");
  const [familyPart, stylePart = ""] = name.split(/[-,]/, 2);
  const family = familyPart
    .replace(/(PSMT|PS|MT)$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  const style = `${stylePart} ${name}`;
  return {
    family: family || undefined,
    bold: /bold|black|heavy|semibold|demi/i.test(style),
    italic: /italic|oblique/i.test(style),
  };
}

/** An axis-aligned ruling line in PDF user space. */
export interface PdfSegment { orientation: "h" | "v"; position: number; start: number; end: number }
export interface PdfFill { x0: number; y0: number; x1: number; y1: number; color: string }
export interface PdfTextColor { x: number; y: number; color: string }
export interface PdfGraphics { segments: PdfSegment[]; fills: PdfFill[]; images: Rect[]; textColors?: PdfTextColor[] }
export const emptyGraphics: PdfGraphics = { segments: [], fills: [], images: [], textColors: [] };

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const THIN = 2.5;

function multiply(m: Matrix, ctm: Matrix): Matrix {
  return [
    m[0] * ctm[0] + m[1] * ctm[2], m[0] * ctm[1] + m[1] * ctm[3],
    m[2] * ctm[0] + m[3] * ctm[2], m[2] * ctm[1] + m[3] * ctm[3],
    m[4] * ctm[0] + m[5] * ctm[2] + ctm[4], m[4] * ctm[1] + m[5] * ctm[3] + ctm[5],
  ];
}
function apply(ctm: Matrix, x: number, y: number) {
  return { x: ctm[0] * x + ctm[2] * y + ctm[4], y: ctm[1] * x + ctm[3] * y + ctm[5] };
}
function toHex(value: unknown) {
  if (typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value)) return value.replace(/^#/, "").toLowerCase();
  if (Array.isArray(value) && value.length >= 3) return value.slice(0, 3).map((part) => Math.round(Number(part)).toString(16).padStart(2, "0")).join("");
  return "000000";
}

/**
 * Extracts ruling segments, filled rectangles, image placements and text fill
 * colours from a PDF.js operator list. `ops` is `pdfjs.OPS` so op codes are
 * never hard-coded.
 */
export function extractPdfGraphics(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, ops: Record<string, number>): PdfGraphics {
  const segments: PdfSegment[] = [];
  const fills: PdfFill[] = [];
  const images: Rect[] = [];
  const textColors: PdfTextColor[] = [];
  const stack: Array<{ ctm: Matrix; fillColor: string }> = [];
  let ctm: Matrix = IDENTITY;
  let textMatrix: Matrix = IDENTITY;
  let textLineMatrix: Matrix = IDENTITY;
  let fillColor = "000000";
  const fillOps = new Set([ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  const strokeOps = new Set([ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  const imageOps = new Set([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject, ops.paintJpegXObject].filter((value) => value !== undefined));
  const textOps = new Set([ops.showText, ops.showSpacedText, ops.nextLineShowText, ops.nextLineSetSpacingShowText].filter((value) => value !== undefined));

  const addPolygon = (points: Array<{ x: number; y: number }>, painted: { fill: boolean; stroke: boolean }) => {
    if (points.length < 2) return;
    const xs = [...new Set(points.map((point) => Math.round(point.x * 10) / 10))];
    const ys = [...new Set(points.map((point) => Math.round(point.y * 10) / 10))];
    const isRectangle = points.length >= 4 && points.length <= 5 && xs.length <= 2 && ys.length <= 2;
    if (isRectangle && painted.fill) {
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const width = x1 - x0, height = y1 - y0;
      if (height <= THIN && width > THIN) segments.push({ orientation: "h", position: (y0 + y1) / 2, start: x0, end: x1 });
      else if (width <= THIN && height > THIN) segments.push({ orientation: "v", position: (x0 + x1) / 2, start: y0, end: y1 });
      else if (width > THIN && height > THIN) fills.push({ x0, y0, x1, y1, color: fillColor });
    }
    if (painted.stroke) {
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1], b = points[index];
        if (Math.abs(a.y - b.y) < .5 && Math.abs(a.x - b.x) > THIN) segments.push({ orientation: "h", position: (a.y + b.y) / 2, start: Math.min(a.x, b.x), end: Math.max(a.x, b.x) });
        else if (Math.abs(a.x - b.x) < .5 && Math.abs(a.y - b.y) > THIN) segments.push({ orientation: "v", position: (a.x + b.x) / 2, start: Math.min(a.y, b.y), end: Math.max(a.y, b.y) });
      }
    }
  };

  const parsePath = (data: ArrayLike<number>, painted: { fill: boolean; stroke: boolean }) => {
    let points: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < data.length;) {
      const op = data[index++];
      if (op === 0) { addPolygon(points, painted); points = [apply(ctm, data[index], data[index + 1])]; index += 2; }
      else if (op === 1) { points.push(apply(ctm, data[index], data[index + 1])); index += 2; }
      else if (op === 2) { points.push(apply(ctm, data[index + 4], data[index + 5])); index += 6; points.push({ x: Number.NaN, y: Number.NaN }); }
      else if (op === 3) { points.push(apply(ctm, data[index + 2], data[index + 3])); index += 4; points.push({ x: Number.NaN, y: Number.NaN }); }
      else if (op === 4) { if (points.length) points.push(points[0]); addPolygon(points.filter((point) => Number.isFinite(point.x)), painted); points = []; }
      else break;
    }
    addPolygon(points.filter((point) => Number.isFinite(point.x)), painted);
  };

  for (let index = 0; index < fnArray.length; index++) {
    const fn = fnArray[index];
    const args = argsArray[index] as unknown[] | null;
    if (fn === ops.save) stack.push({ ctm, fillColor });
    else if (fn === ops.restore) { const saved = stack.pop(); ctm = saved?.ctm ?? IDENTITY; fillColor = saved?.fillColor ?? "000000"; }
    else if (fn === ops.transform && args) ctm = multiply(args.slice(0, 6).map(Number) as Matrix, ctm);
    else if (fn === ops.paintFormXObjectBegin && args) { stack.push({ ctm, fillColor }); if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) ctm = multiply(Array.from(args[0] as ArrayLike<number>).slice(0, 6) as Matrix, ctm); }
    else if (fn === ops.paintFormXObjectEnd) { const saved = stack.pop(); ctm = saved?.ctm ?? IDENTITY; fillColor = saved?.fillColor ?? "000000"; }
    else if (fn === ops.setFillRGBColor && args) fillColor = toHex(args[0] ?? args);
    else if (fn === ops.setFillGray && args) { const gray = Math.round(Number(args[0]) * 255); fillColor = toHex([gray, gray, gray]); }
    else if (fn === ops.beginText) { textMatrix = IDENTITY; textLineMatrix = IDENTITY; }
    else if (fn === ops.setTextMatrix && args) {
      const raw = (Array.isArray(args[0]) || ArrayBuffer.isView(args[0]) || (typeof args[0] === "object" && args[0] !== null))
        ? Array.from(args[0] as ArrayLike<number>)
        : args;
      if (raw.length >= 6) {
        const m = raw.slice(0, 6).map(Number) as Matrix;
        textMatrix = m;
        textLineMatrix = m;
      }
    } else if ((fn === ops.moveText || fn === ops.setLeadingMoveText) && args) {
      const m = multiply([1, 0, 0, 1, Number(args[0]) || 0, Number(args[1]) || 0], textLineMatrix);
      textMatrix = m;
      textLineMatrix = m;
    } else if (textOps.has(fn)) {
      const pos = apply(ctm, textMatrix[4], textMatrix[5]);
      textColors.push({ x: pos.x, y: pos.y, color: fillColor });
    } else if (fn === ops.constructPath && args) {
      // PDF.js >= 5: [paintOp, [pathData], minMax]. Older: [ops[], coords[], minMax].
      if (typeof args[0] !== "number") continue;
      const paintOp = args[0];
      const painted = { fill: fillOps.has(paintOp), stroke: strokeOps.has(paintOp) };
      if (!painted.fill && !painted.stroke) continue;
      const paths = args[1] as unknown;
      const list = Array.isArray(paths) && (Array.isArray(paths[0]) || ArrayBuffer.isView(paths[0])) ? paths as ArrayLike<number>[] : [paths as ArrayLike<number>];
      for (const path of list) if (path && typeof path === "object") parsePath(path, painted);
    } else if (imageOps.has(fn)) {
      const corners = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)];
      const rect = { x0: Math.min(...corners.map((p) => p.x)), y0: Math.min(...corners.map((p) => p.y)), x1: Math.max(...corners.map((p) => p.x)), y1: Math.max(...corners.map((p) => p.y)) };
      if (rect.x1 - rect.x0 > 4 && rect.y1 - rect.y0 > 4) images.push(rect);
    }
  }
  return { segments, fills, images, textColors };
}

// ───────────────────────────── tokens ─────────────────────────────

interface Token {
  text: string;
  bbox: Rect; // layout space (top-left origin)
  baseline: number; // layout space
  fontSize: number;
  bold: boolean;
  italic: boolean;
  font?: string;
  color?: string;
}

function tokensFromItems(items: PdfTextItem[], pageHeight: number, textColors: PdfTextColor[] = []): Token[] {
  return items.flatMap((item) => {
    const text = item.text.normalize("NFC");
    if (!text.trim()) return [];
    const fontSize = Math.max(1, Math.abs(item.height) || 10);
    const baseline = pageHeight - item.y;
    const matchedColor = item.color ?? textColors.find((entry) => Math.abs(entry.x - item.x) <= 2 && Math.abs(entry.y - item.y) <= 2)?.color;
    const color = matchedColor && matchedColor !== "000000" && matchedColor !== "ffffff" ? matchedColor : undefined;
    return [{
      text,
      fontSize,
      baseline,
      bold: Boolean(item.bold),
      italic: Boolean(item.italic),
      font: item.fontFamily,
      color,
      bbox: { x0: item.x, x1: item.x + Math.max(1, Math.abs(item.width)), y0: baseline - fontSize * .8, y1: baseline + fontSize * .22 },
    }];
  });
}

function center(rect: Rect) { return { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 }; }
function inside(point: { x: number; y: number }, rect: Rect, tolerance = 0) {
  return point.x >= rect.x0 - tolerance && point.x <= rect.x1 + tolerance && point.y >= rect.y0 - tolerance && point.y <= rect.y1 + tolerance;
}
function median(values: number[], fallback = 10) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : fallback;
}

/** Groups tokens into visual lines (same baseline), left to right. */
function groupLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [];
  for (const token of [...tokens].sort((a, b) => a.baseline - b.baseline || a.bbox.x0 - b.bbox.x0)) {
    const line = lines.find((candidate) => Math.abs(candidate[0].baseline - token.baseline) <= Math.max(2, Math.min(candidate[0].fontSize, token.fontSize) * .45));
    if (line) line.push(token); else lines.push([token]);
  }
  for (const line of lines) line.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  return lines.sort((a, b) => a[0].baseline - b[0].baseline);
}

/**
 * Runs for a sequence of tokens on one line, inserting spaces from geometry.
 * A wide gap (label … value on a form line) becomes a tab so the visual
 * separation survives in Word.
 */
function runsFromTokens(tokens: Token[], allowTabs = true, tabStops?: number[]): TextRunModel[] {
  const runs: TextRunModel[] = [];
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    let text = token.text;
    if (previous) {
      const gap = token.bbox.x0 - previous.bbox.x1;
      const size = Math.min(previous.fontSize, token.fontSize);
      if (allowTabs && gap > size * 2.2) {
        text = `\t${text.trimStart()}`;
        tabStops?.push(token.bbox.x0);
      } else if (gap > size * .12 && !/\s$/.test(previous.text) && !/^\s/.test(text) && !/^[,.;:!?%…)\]}]/.test(text)) text = ` ${text}`;
    }
    runs.push({ text, bold: token.bold || undefined, italic: token.italic || undefined, size: Math.round(token.fontSize * 2) / 2, font: token.font, color: token.color });
  });
  return runs;
}

/** Joins visual lines of one logical paragraph/cell, keeping hyphenated codes intact. */
function joinLineRuns(lines: Token[][], allowTabs = true, tabStops?: number[]): TextRunModel[] {
  const runs: TextRunModel[] = [];
  lines.forEach((line, index) => {
    const lineRuns = runsFromTokens(line, allowTabs, tabStops);
    if (index > 0 && lineRuns.length) {
      const previousText = runs.map((run) => run.text).join("");
      if (!/[-‐/]$/.test(previousText.trimEnd()) && !/\s$/.test(previousText)) lineRuns[0] = { ...lineRuns[0], text: ` ${lineRuns[0].text.trimStart()}` };
      else if (/\s$/.test(previousText)) lineRuns[0] = { ...lineRuns[0], text: lineRuns[0].text.trimStart() };
    }
    runs.push(...lineRuns);
  });
  if (runs.length) {
    runs[0] = { ...runs[0], text: runs[0].text.trimStart() };
    runs[runs.length - 1] = { ...runs[runs.length - 1], text: runs[runs.length - 1].text.trimEnd() };
  }
  return compactRuns(runs.map((run) => ({ ...run, text: run.text.replace(/ {2,}/g, " ") })));
}

// ───────────────────────────── ruled tables ─────────────────────────────

interface Ruling { orientation: "h" | "v"; position: number; start: number; end: number }

function mergeCollinear(rulings: Ruling[]): Ruling[] {
  const merged: Ruling[] = [];
  for (const orientation of ["h", "v"] as const) {
    const list = rulings.filter((ruling) => ruling.orientation === orientation).sort((a, b) => a.position - b.position || a.start - b.start);
    const rows: Ruling[][] = [];
    for (const ruling of list) {
      const row = rows.find((candidate) => Math.abs(candidate[0].position - ruling.position) <= 1);
      if (row) row.push(ruling); else rows.push([ruling]);
    }
    for (const row of rows) {
      row.sort((a, b) => a.start - b.start);
      let current = { ...row[0] };
      for (const ruling of row.slice(1)) {
        if (ruling.start <= current.end + 1.5) current.end = Math.max(current.end, ruling.end);
        else { merged.push(current); current = { ...ruling }; }
      }
      merged.push(current);
    }
  }
  return merged;
}

function cluster(values: number[], tolerance: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const value of sorted) {
    const group = groups.at(-1);
    if (group && value - group[group.length - 1] <= tolerance) group.push(value); else groups.push([value]);
  }
  return groups.map((group) => group.reduce((sum, value) => sum + value, 0) / group.length);
}

interface GridTable { bbox: Rect; xs: number[]; ys: number[]; cells: Array<{ row: number; column: number; rowSpan: number; colSpan: number; rect: Rect }> }

/** Finds ruled tables. Rulings are given in layout space. */
export function findRuledTables(rulings: Ruling[]): GridTable[] {
  const lines = mergeCollinear(rulings);
  const parent = lines.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const tolerance = 2;
  lines.forEach((a, i) => lines.forEach((b, j) => {
    if (j <= i || a.orientation === b.orientation) return;
    const h = a.orientation === "h" ? a : b, v = a.orientation === "h" ? b : a;
    if (v.position >= h.start - tolerance && v.position <= h.end + tolerance && h.position >= v.start - tolerance && h.position <= v.end + tolerance) parent[find(i)] = find(j);
  }));
  const components = new Map<number, Ruling[]>();
  lines.forEach((line, index) => components.set(find(index), [...(components.get(find(index)) ?? []), line]));

  const tables: GridTable[] = [];
  for (const component of components.values()) {
    const horizontal = component.filter((line) => line.orientation === "h");
    const vertical = component.filter((line) => line.orientation === "v");
    if (horizontal.length < 2 || vertical.length < 2) continue;
    const xs = cluster(vertical.map((line) => line.position), 3.5);
    const ys = cluster(horizontal.map((line) => line.position), 3.5);
    if (xs.length < 2 || ys.length < 2) continue;
    const covers = (line: Ruling, position: number, from: number, to: number) => Math.abs(line.position - position) <= 3.5
      && Math.min(line.end, to) - Math.max(line.start, from) >= (to - from) * .6;
    const hasVertical = (column: number, row: number) => vertical.some((line) => covers(line, xs[column], ys[row], ys[row + 1]));
    const hasHorizontal = (row: number, column: number) => horizontal.some((line) => covers(line, ys[row], xs[column], xs[column + 1]));
    const visited = new Set<string>();
    const cells: GridTable["cells"] = [];
    for (let row = 0; row < ys.length - 1; row++) {
      for (let column = 0; column < xs.length - 1; column++) {
        if (visited.has(`${row}:${column}`)) continue;
        let colSpan = 1;
        while (column + colSpan < xs.length - 1 && !hasVertical(column + colSpan, row)) colSpan++;
        let rowSpan = 1;
        while (row + rowSpan < ys.length - 1
          && Array.from({ length: colSpan }, (_, offset) => column + offset).every((c) => !hasHorizontal(row + rowSpan, c))
          && Array.from({ length: colSpan - 1 }, (_, offset) => column + offset + 1).every((c) => !hasVertical(c, row + rowSpan))) rowSpan++;
        for (let r = row; r < row + rowSpan; r++) for (let c = column; c < column + colSpan; c++) visited.add(`${r}:${c}`);
        cells.push({ row, column, rowSpan, colSpan, rect: { x0: xs[column], x1: xs[column + colSpan], y0: ys[row], y1: ys[row + rowSpan] } });
      }
    }
    tables.push({ bbox: { x0: xs[0], x1: xs[xs.length - 1], y0: ys[0], y1: ys[ys.length - 1] }, xs, ys, cells });
  }
  return tables.sort((a, b) => a.bbox.y0 - b.bbox.y0);
}

/**
 * A merged cell can hold several separate labels ("Lot 1" over two columns,
 * "Lot 2" over four) when the source drew no border between them. Split such a
 * cell at the column boundary lying in the empty gap between the labels.
 */
function splitMergedCellsByText(grid: GridTable, tokens: Token[]): GridTable {
  const cells: GridTable["cells"] = [];
  for (const cell of grid.cells) {
    if (cell.colSpan < 2) { cells.push(cell); continue; }
    const inCell = tokens.filter((token) => inside(center(token.bbox), cell.rect, .5)).sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const lines = groupLines(inCell);
    const segments = lines.length === 1 ? splitLineIntoSegments(lines[0]) : [];
    if (segments.length < 2) { cells.push(cell); continue; }
    const cuts: number[] = [];
    const segmentCenter = (segment: LineSegment) => (segment.bbox.x0 + segment.bbox.x1) / 2;
    for (let index = 1; index < segments.length; index++) {
      const left = segments[index - 1].bbox.x1, right = segments[index].bbox.x0;
      const start = cuts.at(-1) ?? cell.column;
      const end = cell.column + cell.colSpan;
      const candidates = grid.xs
        .map((x, column) => ({ x, column }))
        .filter(({ x, column }) => column > start && column < end && x >= left - 1 && x <= right + 1);
      if (!candidates.length) { cuts.length = 0; break; }
      // Labels in merged cells are normally centred over their span: pick the
      // boundary that centres the label on the left (and, for the last gap,
      // the label on the right over its span) best.
      const rightError = (column: number) => {
        if (index !== segments.length - 1) return 0;
        const rightEnds = grid.xs.map((x, c) => ({ x, c })).filter(({ x, c }) => c > column && c <= end && x >= segments[index].bbox.x1 - 1);
        return rightEnds.length ? Math.min(...rightEnds.map(({ x }) => Math.abs(segmentCenter(segments[index]) - (grid.xs[column] + x) / 2))) : 0;
      };
      const score = (column: number) => Math.abs(segmentCenter(segments[index - 1]) - (grid.xs[start] + grid.xs[column]) / 2) + rightError(column);
      cuts.push(candidates.reduce((best, candidate) => score(candidate.column) < score(best.column) ? candidate : best).column);
    }
    if (!cuts.length) { cells.push(cell); continue; }
    // If the rightmost label is centred over a prefix of the remaining columns
    // (leaving empty columns on the right), split at that trailing boundary too.
    const lastStart = cuts.at(-1)!;
    const cellEnd = cell.column + cell.colSpan;
    const lastSegment = segments.at(-1)!;
    const trailingCandidates = grid.xs
      .map((x, column) => ({ x, column }))
      .filter(({ x, column }) => column > lastStart && column <= cellEnd && x >= lastSegment.bbox.x1 - 1);
    if (trailingCandidates.length) {
      const bestEnd = trailingCandidates.reduce((best, candidate) =>
        Math.abs(segmentCenter(lastSegment) - (grid.xs[lastStart] + candidate.x) / 2) < Math.abs(segmentCenter(lastSegment) - (grid.xs[lastStart] + best.x) / 2) ? candidate : best
      );
      if (bestEnd.column < cellEnd
        && Math.abs(segmentCenter(lastSegment) - (grid.xs[lastStart] + bestEnd.x) / 2) <= 4
        && Math.abs(segmentCenter(lastSegment) - (grid.xs[lastStart] + grid.xs[cellEnd]) / 2) > 8) {
        cuts.push(bestEnd.column);
      }
    }
    const edges = [cell.column, ...cuts, cell.column + cell.colSpan];
    for (let index = 1; index < edges.length; index++) {
      const column = edges[index - 1], colSpan = edges[index] - edges[index - 1];
      cells.push({ ...cell, column, colSpan, rect: { ...cell.rect, x0: grid.xs[column], x1: grid.xs[column + colSpan] } });
    }
  }
  return { ...grid, cells };
}

function smallestFillAt(point: { x: number; y: number }, fills: Array<Rect & { color: string }>) {
  return fills.filter((fill) => inside(point, fill)).sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
}

function cellAlignment(tokens: Token[], rect: Rect): TableCellModel["align"] {
  if (!tokens.length) return undefined;
  const box = rectUnion(tokens.map((token) => token.bbox));
  const left = box.x0 - rect.x0, right = rect.x1 - box.x1;
  if (Math.abs(left - right) <= Math.max(2.5, (rect.x1 - rect.x0) * .08) && left > 3) return "center";
  if (right < left * .4 && left > 6) return "right";
  return "left";
}

function textRunsWithColor(runs: TextRunModel[], shading?: string): TextRunModel[] {
  if (!shading || !isDarkColor(shading)) return runs;
  return runs.map((run) => ({ ...run, color: "ffffff" }));
}

// ─────────────────────────── borderless tables ───────────────────────────

interface LineSegment { tokens: Token[]; bbox: Rect }

function splitLineIntoSegments(line: Token[]): LineSegment[] {
  const segments: LineSegment[] = [];
  for (const token of line) {
    const current = segments.at(-1);
    const gap = current ? token.bbox.x0 - current.bbox.x1 : Number.POSITIVE_INFINITY;
    if (current && gap <= Math.max(token.fontSize, current.tokens.at(-1)!.fontSize) * 1.8) {
      current.tokens.push(token);
      current.bbox = rectUnion([current.bbox, token.bbox]);
    } else segments.push({ tokens: [token], bbox: { ...token.bbox } });
  }
  return segments;
}

/** Columns are the connected groups of horizontally overlapping segments. */
function columnIntervals(segments: LineSegment[]) {
  const intervals = segments.map((segment) => ({ x0: segment.bbox.x0, x1: segment.bbox.x1 })).sort((a, b) => a.x0 - b.x0);
  const columns: Array<{ x0: number; x1: number }> = [];
  for (const interval of intervals) {
    const last = columns.at(-1);
    if (last && interval.x0 <= last.x1 + 2) last.x1 = Math.max(last.x1, interval.x1);
    else columns.push({ ...interval });
  }
  return columns;
}

/** Aligned multi-column runs of lines (forms, signature rows) become borderless tables. */
function findBorderlessTables(lines: Token[][]): Array<{ lines: Token[][]; table: TableBlock }> {
  const results: Array<{ lines: Token[][]; table: TableBlock }> = [];
  const segmented = lines.map((line) => ({ line, segments: splitLineIntoSegments(line) }));
  let index = 0;
  while (index < segmented.length) {
    const first = segmented[index];
    if (first.segments.length < 2) { index++; continue; }
    const run = [first];
    for (let next = index + 1; next < segmented.length; next++) {
      const candidate = segmented[next];
      const previous = run.at(-1)!;
      const gap = candidate.line[0].bbox.y0 - Math.max(...previous.line.map((token) => token.bbox.y1));
      const lineHeight = Math.max(...previous.line.map((token) => token.fontSize));
      if (candidate.segments.length < 2 || gap > lineHeight * 1.6) break;
      // Adding the row must not merge two existing columns into one.
      const before = columnIntervals(run.flatMap((row) => row.segments)).length;
      const after = columnIntervals([...run.flatMap((row) => row.segments), ...candidate.segments]).length;
      if (after < before) break;
      run.push(candidate);
    }
    const columns = columnIntervals(run.flatMap((row) => row.segments));
    if (run.length >= 2 && columns.length >= 2) {
      const boundaries = [columns[0].x0, ...columns.slice(1).map((column, i) => (columns[i].x1 + column.x0) / 2), columns.at(-1)!.x1];
      // A column whose entries share a centre but not a left edge is centred text.
      const centeredColumns = columns.map((interval) => {
        const members = run.flatMap((row) => row.segments).filter((segment) => segment.bbox.x0 <= interval.x1 && segment.bbox.x1 >= interval.x0);
        const centers = members.map((segment) => (segment.bbox.x0 + segment.bbox.x1) / 2);
        const starts = members.map((segment) => segment.bbox.x0);
        return members.length >= 2 && Math.max(...centers) - Math.min(...centers) <= 4 && Math.max(...starts) - Math.min(...starts) > 4;
      });
      const rows = run.map((row) => {
        const cells: TableBlock["rows"][number] = [];
        for (const segment of row.segments) {
          const column = Math.max(0, columns.findIndex((interval) => segment.bbox.x0 <= interval.x1 && segment.bbox.x1 >= interval.x0));
          const existing = cells.find((cell) => cell.column === column);
          const runs = runsFromTokens(segment.tokens, false);
          if (existing) existing.runs = compactRuns([...existing.runs, { text: " " }, ...runs]);
          else cells.push({ column, colSpan: 1, rowSpan: 1, runs: compactRuns(runs) });
        }
        // Fill gaps so every row spans the full grid.
        for (let column = 0; column < columns.length; column++) if (!cells.some((cell) => cell.column === column)) cells.push({ column, colSpan: 1, rowSpan: 1, runs: [] });
        return cells.sort((a, b) => a.column - b.column).map((cell) => ({ ...cell, align: centeredColumns[cell.column] ? "center" as const : undefined }));
      });
      const widths = boundaries.slice(1).map((boundary, column) => Math.max(18, boundary - boundaries[column]));
      results.push({
        lines: run.map((row) => row.line),
        table: { kind: "table", bordered: false, columnWidths: widths, rows, bbox: rectUnion(run.flatMap((row) => row.line.map((token) => token.bbox))) },
      });
      index += run.length;
    } else index++;
  }
  return results;
}

// ─────────────────────────────── paragraphs ───────────────────────────────

const listMarker = /^\s*(?:\d{1,3}[.)]|[a-zđ][.)]|[-–•‣◦▪●*+])\s+/u;

function lineText(line: Token[]) { return runsFromTokens(line).map((run) => run.text).join(""); }

function buildParagraphs(lines: Token[][], bodySize: number, contentBox: Rect, fills: Array<Rect & { color: string }>): ParagraphBlock[] {
  const blocks: Array<{ lines: Token[][]; kind: ParagraphBlock["kind"]; level?: 1 | 2 }> = [];
  for (const line of lines) {
    const text = lineText(line).trim();
    const size = median(line.map((token) => token.fontSize));
    const bold = line.every((token) => token.bold);
    const isList = listMarker.test(text);
    const isHeading = size >= bodySize * 1.2 || (bold && text.length <= 90 && size >= bodySize * .95 && !isList);
    const kind: ParagraphBlock["kind"] = isList ? "list-item" : isHeading ? "heading" : "paragraph";
    const previous = blocks.at(-1);
    const previousLine = previous?.lines.at(-1);
    if (previous && previousLine) {
      const previousSize = median(previousLine.map((token) => token.fontSize));
      const gap = line[0].bbox.y0 - Math.max(...previousLine.map((token) => token.bbox.y1));
      const previousBox = rectUnion(previousLine.map((token) => token.bbox));
      const box = rectUnion(line.map((token) => token.bbox));
      const sameColumn = Math.min(previousBox.x1, box.x1) - Math.max(previousBox.x0, box.x0) > 0;
      const similarSize = Math.abs(previousSize - size) <= Math.max(previousSize, size) * .15;
      const sameStyle = previousLine.every((token) => token.bold) === bold;
      const closeEnough = gap <= Math.max(previousSize, size) * .75;
      const continuesList = previous.kind === "list-item" && kind === "paragraph" && box.x0 > rectUnion(previous.lines[0].map((token) => token.bbox)).x0 + 2;
      const continuesText = previous.kind === kind && kind !== "list-item";
      // "Label: value" lines are separate fields, not wrapped prose.
      const startsField = /^[\p{L}][\p{L}\p{N} /.()-]{0,32}:\s/u.test(text);
      if (sameColumn && similarSize && closeEnough && !startsField && (continuesList || (continuesText && sameStyle))) { previous.lines.push(line); continue; }
    }
    blocks.push({ lines: [line], kind, level: isHeading ? (size >= bodySize * 1.5 ? 1 : 2) : undefined });
  }

  // Wrapped prose fills the column; a clearly short line ends its paragraph.
  const splitBlocks = blocks.flatMap((block) => {
    if (block.lines.length < 2) return [block];
    const rights = block.lines.map((line) => Math.max(...line.map((token) => token.bbox.x1)));
    const lefts = block.lines.map((line) => Math.min(...line.map((token) => token.bbox.x0)));
    const maxRight = Math.max(...rights);
    const width = maxRight - Math.min(...lefts);
    const size = median(block.lines.flat().map((token) => token.fontSize));
    const parts: typeof blocks = [];
    let current: typeof block = { ...block, lines: [] };
    block.lines.forEach((line, index) => {
      current.lines.push(line);
      const isLast = index === block.lines.length - 1;
      if (!isLast && rights[index] < maxRight - Math.max(size * 3, width * .12)) {
        parts.push(current);
        current = { ...block, kind: block.kind === "list-item" ? "paragraph" : block.kind, lines: [] };
      }
    });
    if (current.lines.length) parts.push(current);
    return parts;
  });

  const contentCenter = (contentBox.x0 + contentBox.x1) / 2;
  return splitBlocks.map((block) => {
    const tokens = block.lines.flat();
    const bbox = rectUnion(tokens.map((token) => token.bbox));
    const fontSize = median(tokens.map((token) => token.fontSize));
    const tabStops: number[] = [];
    let runs = joinLineRuns(block.lines, true, tabStops);
    let listType: ParagraphBlock["listType"];
    if (block.kind === "list-item") {
      const text = runs.map((run) => run.text).join("");
      const marker = text.match(listMarker)?.[0] ?? "";
      listType = /\d|[a-zđ][.)]/u.test(marker) ? "ordered" : "bullet";
      let remove = marker.length;
      runs = runs.map((run) => {
        if (remove <= 0) return run;
        const cut = Math.min(remove, run.text.length);
        remove -= cut;
        return { ...run, text: run.text.slice(cut) };
      }).filter((run) => run.text);
    }
    const width = bbox.x1 - bbox.x0;
    const lineWidths = block.lines.map((line) => rectUnion(line.map((token) => token.bbox))).map((box) => box.x1 - box.x0);
    const centered = Math.abs((bbox.x0 + bbox.x1) / 2 - contentCenter) <= 8 && bbox.x0 - contentBox.x0 > 24 && width < (contentBox.x1 - contentBox.x0) * .85;
    const justified = block.lines.length >= 2 && lineWidths.slice(0, -1).every((lineWidth) => lineWidth >= width * .9);
    const fill = smallestFillAt(center(bbox), fills);
    const shading = fill && !isNearWhite(fill.color) ? fill.color : undefined;
    // A banner is centred inside its coloured band, not on the whole page.
    const bandCentered = fill && shading ? Math.abs((bbox.x0 + bbox.x1) / 2 - (fill.x0 + fill.x1) / 2) <= 8 && bbox.x0 - fill.x0 > 12 : false;
    return {
      kind: block.kind,
      level: block.level,
      listType,
      runs: textRunsWithColor(runs, shading),
      bbox,
      fontSize,
      align: centered || bandCentered ? "center" : justified ? "justify" : "left",
      shading,
      shadingBox: shading && fill ? { x0: fill.x0, x1: fill.x1, y0: fill.y0, y1: fill.y1 } : undefined,
      tabStops: tabStops.length ? tabStops : undefined,
    } satisfies ParagraphBlock;
  });
}

// ───────────────────────────── page layout ─────────────────────────────

export interface LayoutOptions {
  /** Crop polygon in layout space; tokens/graphics outside it are ignored. */
  crop?: Array<{ x: number; y: number }>;
}

function insidePolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

/** Builds the editable page model from PDF text items and drawing graphics. */
export function layoutTextLayerPage(items: PdfTextItem[], graphics: PdfGraphics, page: { width: number; height: number }, options: LayoutOptions = {}): PageContent {
  const flip = (y: number) => page.height - y;
  const keep = (rect: Rect) => !options.crop || insidePolygon(center(rect), options.crop);
  let tokens = tokensFromItems(items, page.height, graphics.textColors).filter((token) => keep(token.bbox));
  const pageArea = page.width * page.height;
  const fills = graphics.fills
    .map((fill) => ({ x0: fill.x0, x1: fill.x1, y0: flip(fill.y1), y1: flip(fill.y0), color: fill.color }))
    .filter((fill) => (fill.x1 - fill.x0) * (fill.y1 - fill.y0) < pageArea * .5 && keep(fill));
  const rulings: Ruling[] = graphics.segments.map((segment) => segment.orientation === "h"
    ? { orientation: "h" as const, position: flip(segment.position), start: segment.start, end: segment.end }
    : { orientation: "v" as const, position: segment.position, start: flip(segment.end), end: flip(segment.start) })
    .filter((ruling) => keep(ruling.orientation === "h" ? { x0: ruling.start, x1: ruling.end, y0: ruling.position, y1: ruling.position } : { x0: ruling.position, x1: ruling.position, y0: ruling.start, y1: ruling.end }));
  // Coloured cell backgrounds also delimit cells (white gaps between red cells).
  for (const fill of fills) {
    if (isNearWhite(fill.color)) continue;
    rulings.push(
      { orientation: "h", position: fill.y0, start: fill.x0, end: fill.x1 },
      { orientation: "h", position: fill.y1, start: fill.x0, end: fill.x1 },
      { orientation: "v", position: fill.x0, start: fill.y0, end: fill.y1 },
      { orientation: "v", position: fill.x1, start: fill.y0, end: fill.y1 },
    );
  }

  const blocks: DocumentBlock[] = [];
  const bodySize = median(tokens.flatMap((token) => Array(Math.max(1, Math.min(40, token.text.length))).fill(token.fontSize)), 11);

  for (const found of findRuledTables(rulings)) {
    const grid = splitMergedCellsByText(found, tokens);
    const cellTokens = grid.cells.map((cell) => tokens.filter((token) => inside(center(token.bbox), cell.rect, .5)));
    const columns = grid.xs.length - 1;
    const rows = grid.ys.length - 1;
    const filledCells = cellTokens.filter((list) => list.length).length;
    if (columns < 2 || rows < 1 || (rows < 2 && columns < 2) || filledCells < 2) continue;
    const used = new Set(cellTokens.flat());
    tokens = tokens.filter((token) => !used.has(token));
    const tableRows: TableBlock["rows"] = Array.from({ length: rows }, () => []);
    grid.cells.forEach((cell, index) => {
      const fill = smallestFillAt(center(cell.rect), fills);
      const shading = fill && !isPureWhite(fill.color) ? fill.color : undefined;
      const runs = textRunsWithColor(joinLineRuns(groupLines(cellTokens[index])), shading);
      tableRows[cell.row].push({ column: cell.column, colSpan: cell.colSpan, rowSpan: cell.rowSpan, runs, shading, align: cellAlignment(cellTokens[index], cell.rect) });
    });
    blocks.push({ kind: "table", bordered: true, bbox: grid.bbox, columnWidths: grid.xs.slice(1).map((x, column) => x - grid.xs[column]), rows: tableRows.map((row) => row.sort((a, b) => a.column - b.column)) });
  }

  let lines = groupLines(tokens);
  for (const { lines: tableLines, table } of findBorderlessTables(lines)) {
    blocks.push(table);
    const used = new Set(tableLines);
    lines = lines.filter((line) => !used.has(line));
  }

  const contentBox = items.length ? rectUnion(tokensFromItems(items, page.height, graphics.textColors).map((token) => token.bbox)) : { x0: 0, y0: 0, x1: page.width, y1: page.height };
  blocks.push(...buildParagraphs(lines, bodySize, contentBox, fills));

  for (const image of graphics.images) {
    const rect = { x0: image.x0, x1: image.x1, y0: flip(image.y1), y1: flip(image.y0) };
    if (keep(rect)) blocks.push({ kind: "image", bbox: rect } satisfies ImageBlock);
  }

  // Reading order: top to bottom; blocks sharing a band keep left-to-right order.
  blocks.sort((a, b) => {
    const overlap = Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0);
    const sameBand = overlap > Math.min(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0) * .5;
    return sameBand ? a.bbox.x0 - b.bbox.x0 : a.bbox.y0 - b.bbox.y0;
  });
  return { width: page.width, height: page.height, source: "text-layer", blocks };
}
