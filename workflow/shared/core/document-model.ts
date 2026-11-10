/**
 * Output-neutral document model shared by the text-layer and OCR paths and
 * consumed by the DOCX exporter.
 *
 * Every rectangle is in "layout space": points (1/72 inch), origin at the top
 * left of the page, y growing downwards.
 */

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface TextRunModel {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Low-confidence OCR text the user may want to check. */
  flagged?: boolean;
  /** Hex colour without '#'. */
  color?: string;
  /** Font size in points. */
  size?: number;
  /** Font family of the source PDF, when known ("Calibri", "Times New Roman"). */
  font?: string;
}

export type ParagraphKind = "title" | "heading" | "paragraph" | "list-item";

export interface ParagraphBlock {
  kind: ParagraphKind;
  runs: TextRunModel[];
  bbox: Rect;
  fontSize: number;
  level?: 1 | 2;
  listType?: "ordered" | "bullet";
  align?: "left" | "center" | "right" | "justify";
  /** Hex background colour without '#'. */
  shading?: string;
  /** Extent of the coloured band behind the paragraph (banners are wider than their text). */
  shadingBox?: Rect;
  /** Tab stop x-positions in layout points for multi-field form lines. */
  tabStops?: number[];
}

export interface TableCellModel {
  runs: TextRunModel[];
  colSpan: number;
  rowSpan: number;
  shading?: string;
  align?: "left" | "center" | "right";
}

export interface TableBlock {
  kind: "table";
  bbox: Rect;
  /** Column widths in points. */
  columnWidths: number[];
  /** One entry per grid row: the cells that start in that row, left to right. */
  rows: Array<Array<TableCellModel & { column: number }>>;
  bordered: boolean;
}

export interface ImageBlock {
  kind: "image";
  bbox: Rect;
  /** Filled in by the browser adapter (PNG bytes). */
  data?: Uint8Array;
}

export type DocumentBlock = ParagraphBlock | TableBlock | ImageBlock;

export interface PageContent {
  width: number;
  height: number;
  source: "text-layer" | "ocr";
  blocks: DocumentBlock[];
}

export function plainText(runs: TextRunModel[]) {
  return runs.map((run) => run.text).join("");
}

export function rectUnion(rects: Rect[]): Rect {
  return {
    x0: Math.min(...rects.map((rect) => rect.x0)),
    y0: Math.min(...rects.map((rect) => rect.y0)),
    x1: Math.max(...rects.map((rect) => rect.x1)),
    y1: Math.max(...rects.map((rect) => rect.y1)),
  };
}

export function isDarkColor(hex: string) {
  const value = hex.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return false;
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  return red * .299 + green * .587 + blue * .114 < .5;
}

export function isNearWhite(hex: string) {
  const value = hex.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return false;
  return [0, 2, 4].every((offset) => parseInt(value.slice(offset, offset + 2), 16) >= 245);
}

export function isPureWhite(hex: string) {
  const value = hex.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return false;
  return [0, 2, 4].every((offset) => parseInt(value.slice(offset, offset + 2), 16) >= 252);
}

/** Merges adjacent runs with identical formatting so DOCX output stays compact. */
export function compactRuns(runs: TextRunModel[]): TextRunModel[] {
  const output: TextRunModel[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = output.at(-1);
    if (last && last.bold === run.bold && last.italic === run.italic && last.flagged === run.flagged && last.color === run.color && last.size === run.size && last.font === run.font) last.text += run.text;
    else output.push({ ...run });
  }
  return output;
}
