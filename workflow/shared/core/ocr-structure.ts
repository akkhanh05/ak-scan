/**
 * Turns positioned OCR lines of one rendered page into the shared document
 * model: paragraphs (using Tesseract's paragraph segmentation plus geometry),
 * headings, list items and, when a ruled grid was detected in the image, a
 * table whose cells receive the recognised words.
 */

import { compactRuns, rectUnion } from "./document-model";
import type { DocumentBlock, PageContent, ParagraphBlock, Rect, TableBlock, TextRunModel } from "./document-model";
import { LOW_CONFIDENCE, normalizeOcrText } from "./ocr";
import type { PositionedOcrLine } from "./ocr";

export interface OcrTableGrid { xLines: number[]; yLines: number[] }

export interface OcrLayoutOptions {
  /** Points per image pixel. */
  scale: number;
  grid?: OcrTableGrid | null;
}

const listMarker = /^\s*(?:\d{1,3}[.)]|[a-zđ][.)]|[-–•‣◦▪●*+])\s+/u;

function median(values: number[], fallback = 1) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : fallback;
}
function toPoints(rect: Rect, scale: number): Rect {
  return { x0: rect.x0 * scale, y0: rect.y0 * scale, x1: rect.x1 * scale, y1: rect.y1 * scale };
}
function lineHeight(line: PositionedOcrLine) { return Math.max(1, line.bbox.y1 - line.bbox.y0); }

/** Runs for one line; low-confidence words are kept and marked as flagged. */
function lineRuns(line: PositionedOcrLine): TextRunModel[] {
  if (!line.words.length) return [{ text: normalizeOcrText(line.text), flagged: line.confidence < LOW_CONFIDENCE || undefined }];
  const runs: TextRunModel[] = [];
  line.words.forEach((word, index) => {
    const text = word.text.trim();
    if (!text) return;
    const glue = index === 0 || /^[,.;:!?%…)\]}»”’]/u.test(text) || /[(\[{«“‘]$/u.test(line.words[index - 1]?.text ?? "") ? "" : " ";
    runs.push({ text: `${glue}${text}`, flagged: word.confidence < LOW_CONFIDENCE || undefined });
  });
  return compactRuns(runs);
}

function joinRuns(lines: PositionedOcrLine[]): TextRunModel[] {
  const runs: TextRunModel[] = [];
  lines.forEach((line, index) => {
    const next = lineRuns(line);
    if (index > 0 && next.length) {
      const previousText = runs.map((run) => run.text).join("");
      // Keep hyphenated codes ("SS6960-" + "Phantom") intact; otherwise a space.
      if (!/[-/]$/.test(previousText)) next[0] = { ...next[0], text: ` ${next[0].text}` };
    }
    runs.push(...next);
  });
  return compactRuns(runs);
}

function wordsInRect(lines: PositionedOcrLine[], rect: Rect) {
  return lines.flatMap((line) => (line.words.length ? line.words : [{ text: line.text, confidence: line.confidence, bbox: line.bbox }])
    .filter((word) => {
      const x = (word.bbox.x0 + word.bbox.x1) / 2, y = (word.bbox.y0 + word.bbox.y1) / 2;
      return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
    }));
}

function tableFromGrid(grid: OcrTableGrid, lines: PositionedOcrLine[], scale: number): { table: TableBlock; consumed: Set<PositionedOcrLine> } | null {
  const xs = [...grid.xLines].sort((a, b) => a - b);
  const ys = [...grid.yLines].sort((a, b) => a - b);
  if (xs.length < 3 || ys.length < 3) return null;
  const region = { x0: xs[0], x1: xs.at(-1)!, y0: ys[0], y1: ys.at(-1)! };
  const consumed = new Set(lines.filter((line) => {
    const words = line.words.length ? line.words : [line];
    const insideCount = words.filter((word) => {
      const x = (word.bbox.x0 + word.bbox.x1) / 2, y = (word.bbox.y0 + word.bbox.y1) / 2;
      return x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;
    }).length;
    return insideCount / words.length >= .5;
  }));
  if (consumed.size < 2) return null;
  const rows: TableBlock["rows"] = [];
  let filled = 0;
  for (let row = 0; row < ys.length - 1; row++) {
    const cells: TableBlock["rows"][number] = [];
    for (let column = 0; column < xs.length - 1; column++) {
      const rect = { x0: xs[column], x1: xs[column + 1], y0: ys[row], y1: ys[row + 1] };
      const words = wordsInRect([...consumed], rect).sort((a, b) => (a.bbox.y0 - b.bbox.y0) || (a.bbox.x0 - b.bbox.x0));
      const text = normalizeOcrText(words.map((word) => word.text).join(" "));
      if (text) filled++;
      cells.push({ column, colSpan: 1, rowSpan: 1, runs: text ? [{ text, flagged: words.some((word) => word.confidence < LOW_CONFIDENCE) || undefined }] : [] });
    }
    rows.push(cells);
  }
  if (filled < 2) return null;
  return {
    consumed,
    table: { kind: "table", bordered: true, bbox: toPoints(region, scale), columnWidths: xs.slice(1).map((x, index) => (x - xs[index]) * scale), rows },
  };
}

/** Builds the page model from OCR lines given in reading order (pixel coordinates). */
export function layoutOcrPage(lines: PositionedOcrLine[], image: { width: number; height: number }, options: OcrLayoutOptions): PageContent {
  const { scale } = options;
  const blocks: DocumentBlock[] = [];
  let remaining = lines.filter((line) => normalizeOcrText(line.text));
  const tableResult = options.grid ? tableFromGrid(options.grid, remaining, scale) : null;
  if (tableResult) remaining = remaining.filter((line) => !tableResult.consumed.has(line));

  const bodyHeight = median(remaining.map(lineHeight), 20);
  const groups: Array<{ lines: PositionedOcrLine[]; kind: ParagraphBlock["kind"] }> = [];
  for (const line of remaining) {
    const text = normalizeOcrText(line.text);
    const isList = listMarker.test(text);
    const isHeading = lineHeight(line) >= bodyHeight * 1.3 && text.length <= 100 && !isList;
    const kind: ParagraphBlock["kind"] = isList ? "list-item" : isHeading ? "heading" : "paragraph";
    const previous = groups.at(-1);
    const last = previous?.lines.at(-1);
    if (previous && last) {
      const gap = line.bbox.y0 - last.bbox.y1;
      const overlap = Math.min(last.bbox.x1, line.bbox.x1) - Math.max(last.bbox.x0, line.bbox.x0);
      const sameParagraph = line.paragraphKey !== undefined && line.paragraphKey === last.paragraphKey;
      const similarHeight = Math.abs(lineHeight(line) - lineHeight(last)) <= Math.max(lineHeight(line), lineHeight(last)) * .3;
      const geometricContinuation = gap >= -lineHeight(line) * .3 && gap <= Math.max(lineHeight(line), lineHeight(last)) * .9 && overlap > 0 && similarHeight;
      const continuesList = previous.kind === "list-item" && kind === "paragraph" && line.bbox.x0 > previous.lines[0].bbox.x0 + bodyHeight * .4;
      const sameKind = previous.kind === kind && kind !== "list-item";
      // Tesseract's own paragraph split is trusted unless the lines are packed tightly.
      const trusted = sameParagraph || gap <= Math.min(lineHeight(line), lineHeight(last)) * .6;
      if (geometricContinuation && trusted && (continuesList || sameKind)) { previous.lines.push(line); continue; }
    }
    groups.push({ lines: [line], kind });
  }

  // A clearly short line inside a group ends that paragraph (address blocks, forms).
  const split = groups.flatMap((group) => {
    if (group.lines.length < 2) return [group];
    const maxRight = Math.max(...group.lines.map((line) => line.bbox.x1));
    const width = maxRight - Math.min(...group.lines.map((line) => line.bbox.x0));
    const parts: typeof groups = [];
    let current: (typeof groups)[number] = { ...group, lines: [] };
    group.lines.forEach((line, index) => {
      current.lines.push(line);
      if (index < group.lines.length - 1 && line.bbox.x1 < maxRight - Math.max(bodyHeight * 2.5, width * .12)) {
        parts.push(current);
        current = { kind: group.kind === "list-item" ? "paragraph" : group.kind, lines: [] };
      }
    });
    if (current.lines.length) parts.push(current);
    return parts;
  });

  const pageCenter = image.width / 2;
  split.forEach((group, index) => {
    const bbox = rectUnion(group.lines.map((line) => line.bbox));
    const height = median(group.lines.map(lineHeight));
    let runs = joinRuns(group.lines);
    let listType: ParagraphBlock["listType"];
    if (group.kind === "list-item") {
      const marker = runs.map((run) => run.text).join("").match(listMarker)?.[0] ?? "";
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
    const centered = Math.abs((bbox.x0 + bbox.x1) / 2 - pageCenter) <= image.width * .03 && width < image.width * .7 && bbox.x0 > image.width * .15;
    const justified = group.lines.length >= 2 && group.lines.slice(0, -1).every((line) => line.bbox.x1 - line.bbox.x0 >= width * .9);
    const isTitle = group.kind === "heading" && index === 0 && bbox.y0 < image.height * .25;
    blocks.push({
      kind: isTitle ? "title" : group.kind,
      level: group.kind === "heading" ? (height >= bodyHeight * 1.7 ? 1 : 2) : undefined,
      listType,
      runs,
      bbox: toPoints(bbox, scale),
      // Cap height is roughly 70% of the line box (ascenders + descenders).
      fontSize: Math.max(7, Math.min(36, Math.round(height * scale / 1.3 * 2) / 2)),
      align: centered ? "center" : justified ? "justify" : "left",
    });
  });

  // Paragraphs stay in Tesseract's reading order (columns are not interleaved);
  // the table is inserted before the first paragraph that starts below it.
  if (tableResult) {
    const index = blocks.findIndex((block) => block.bbox.y0 >= tableResult.table.bbox.y0);
    blocks.splice(index < 0 ? blocks.length : index, 0, tableResult.table);
  }
  return { width: image.width * scale, height: image.height * scale, source: "ocr", blocks };
}
