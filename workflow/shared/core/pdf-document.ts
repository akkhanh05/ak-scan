/**
 * A portable document-layout model for PDF → DOCX.  The browser integration
 * adapts PDF.js/Tesseract to these small interfaces; keeping this file free of
 * either package makes the structure testable and reusable by an API later.
 */

export type PdfContentSource = "text-layer" | "ocr";
export type DocumentBlockKind = "paragraph" | "heading" | "list-item" | "table" | "image";
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface DocumentToken {
  text: string; bbox: Rect; page: number; fontSize: number; fontName?: string;
  bold?: boolean; italic?: boolean; confidence: number; source: PdfContentSource;
}
export interface DocumentLine { tokens: DocumentToken[]; text: string; bbox: Rect; fontSize: number; }
export interface DocumentTable { bbox: Rect; rows: string[][]; }
export interface DocumentImage { bbox: Rect; altText?: string; }
export interface DocumentBlock { kind: DocumentBlockKind; bbox: Rect; text?: string; lines?: DocumentLine[]; table?: DocumentTable; image?: DocumentImage; level?: number; }
export interface ExtractedPdfPage { page: number; width: number; height: number; source: PdfContentSource; tokens: DocumentToken[]; blocks: DocumentBlock[]; confidence: number; }
export interface ExtractedPdfDocument { pages: ExtractedPdfPage[]; usedOcr: boolean; }

/** Structural subset of PDF.js TextItem, deliberately not imported at runtime. */
export interface PdfJsTextItem { str: string; transform: number[]; width: number; height?: number; fontName?: string; hasEOL?: boolean; }
export interface PdfJsPage { getViewport(options: { scale: number }): { width: number; height: number }; getTextContent(): Promise<{ items: Array<PdfJsTextItem | unknown> }>; }
export interface PdfJsDocument { numPages: number; getPage(pageNumber: number): Promise<PdfJsPage>; }
export interface OcrPageResult { width: number; height: number; words: Array<{ text: string; confidence: number; bbox: Rect; fontSize?: number; bold?: boolean; italic?: boolean }>; }
export type OcrPageReader = (page: PdfJsPage, pageNumber: number) => Promise<OcrPageResult>;

const punctuation = /^[,.;:!?%…)}\]»]+$/u;
const listMarker = /^(?:[-•‣◦]|\d{1,3}[.)])$/u;
function bounds(tokens: DocumentToken[]): Rect {
  return { x0: Math.min(...tokens.map((t) => t.bbox.x0)), y0: Math.min(...tokens.map((t) => t.bbox.y0)), x1: Math.max(...tokens.map((t) => t.bbox.x1)), y1: Math.max(...tokens.map((t) => t.bbox.y1)) };
}
function median(values: number[]) { const ordered = [...values].sort((a, b) => a - b); return ordered[Math.floor((ordered.length - 1) / 2)] ?? 10; }
export function textFromTokens(tokens: DocumentToken[]) {
  return tokens.reduce((text, token) => !text ? token.text : punctuation.test(token.text) ? text + token.text : `${text} ${token.text}`, "").replace(/\s+([,.;:!?%…])/g, "$1");
}

export function tokensFromPdfTextItems(items: PdfJsTextItem[], page: number): DocumentToken[] {
  return items.flatMap((item) => {
    const text = item.str.normalize("NFC").trim();
    if (!text) return [];
    const fontSize = Math.max(1, Math.abs(item.transform[3]) || Math.abs(item.height ?? 0) || 10);
    const x0 = item.transform[4] ?? 0;
    const y1 = item.transform[5] ?? 0;
    const width = Math.max(1, Math.abs(item.width));
    return [{ text, page, fontSize, fontName: item.fontName, confidence: 100, source: "text-layer" as const, bbox: { x0, y0: y1 - fontSize, x1: x0 + width, y1 } }];
  });
}

export function linesFromTokens(tokens: DocumentToken[]): DocumentLine[] {
  const source = [...tokens].sort((a, b) => b.bbox.y1 - a.bbox.y1 || a.bbox.x0 - b.bbox.x0);
  const lines: DocumentToken[][] = [];
  for (const token of source) {
    const tolerance = Math.max(2, token.fontSize * .45);
    const line = lines.find((candidate) => Math.abs(candidate[0].bbox.y1 - token.bbox.y1) <= tolerance);
    if (line) line.push(token); else lines.push([token]);
  }
  return lines.map((tokens) => {
    tokens.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    return { tokens, text: textFromTokens(tokens), bbox: bounds(tokens), fontSize: median(tokens.map((token) => token.fontSize)) };
  });
}

function inferTables(lines: DocumentLine[]): { tables: DocumentTable[]; members: Set<DocumentLine> } {
  const members = new Set<DocumentLine>(); const tables: DocumentTable[] = [];
  const candidates = lines.filter((line) => line.tokens.length >= 2 && line.tokens.some((token, i) => i > 0 && token.bbox.x0 - line.tokens[i - 1].bbox.x1 > line.fontSize * 3));
  if (candidates.length < 2) return { tables, members };
  const columns = candidates.map((line) => line.tokens.map((token) => token.bbox.x0));
  const aligned = columns.filter((starts, i) => columns.some((other, j) => i !== j && starts.length === other.length && starts.every((x, index) => Math.abs(x - other[index]) < 18)));
  if (aligned.length < 2) return { tables, members };
  const tableLines = candidates.filter((line) => aligned.some((starts) => starts.length === line.tokens.length && starts.every((x, i) => Math.abs(x - line.tokens[i].bbox.x0) < 18)));
  tableLines.forEach((line) => members.add(line));
  tables.push({ bbox: bounds(tableLines.flatMap((line) => line.tokens)), rows: tableLines.map((line) => line.tokens.map((token) => token.text)) });
  return { tables, members };
}

export function analyzePageLayout(tokens: DocumentToken[], images: DocumentImage[] = []): DocumentBlock[] {
  const lines = linesFromTokens(tokens); const bodySize = median(lines.map((line) => line.fontSize));
  const { tables, members } = inferTables(lines);
  const blocks: DocumentBlock[] = [];
  for (const table of tables) blocks.push({ kind: "table", bbox: table.bbox, table });
  for (const image of images) blocks.push({ kind: "image", bbox: image.bbox, image });
  for (const line of lines) {
    if (members.has(line)) continue;
    const marker = line.tokens[0]?.text ?? "";
    const heading = (line.fontSize >= bodySize * 1.22 || (lines.length === 1 && line.fontSize >= 16)) || (line.tokens.some((token) => token.bold) && line.text.length < 100);
    blocks.push({ kind: listMarker.test(marker) ? "list-item" : heading ? "heading" : "paragraph", bbox: line.bbox, text: line.text, lines: [line], level: heading ? (line.fontSize >= bodySize * 1.5 ? 1 : 2) : undefined });
  }
  return blocks.sort((a, b) => b.bbox.y1 - a.bbox.y1 || a.bbox.x0 - b.bbox.x0);
}

/** Reflows visual PDF lines into semantic paragraphs for editable Word output. */
export function mergeDocumentParagraphs(blocks: DocumentBlock[]) {
  const merged: DocumentBlock[] = [];
  for (const block of blocks) {
    const previous = merged.at(-1);
    if (block.kind !== "paragraph" || previous?.kind !== "paragraph") {
      merged.push({ ...block, lines: block.lines ? [...block.lines] : undefined });
      continue;
    }
    const previousSize = previous.lines?.at(-1)?.fontSize ?? 11;
    const currentSize = block.lines?.[0]?.fontSize ?? 11;
    const verticalGap = Math.max(0, previous.bbox.y0 - block.bbox.y1);
    const sameIndent = Math.abs(previous.bbox.x0 - block.bbox.x0) <= Math.max(previousSize, currentSize) * 1.25;
    const sameParagraph = verticalGap <= Math.max(previousSize, currentSize) * .72 && sameIndent;
    if (!sameParagraph) {
      merged.push({ ...block, lines: block.lines ? [...block.lines] : undefined });
      continue;
    }
    previous.text = `${previous.text ?? ""} ${block.text ?? ""}`.replace(/\s+/g, " ").trim();
    previous.lines = [...(previous.lines ?? []), ...(block.lines ?? [])];
    previous.bbox = {
      x0: Math.min(previous.bbox.x0, block.bbox.x0),
      y0: Math.min(previous.bbox.y0, block.bbox.y0),
      x1: Math.max(previous.bbox.x1, block.bbox.x1),
      y1: Math.max(previous.bbox.y1, block.bbox.y1),
    };
  }
  return merged;
}

export async function extractPdfDocument(pdf: PdfJsDocument, ocr: OcrPageReader, imagesByPage: Record<number, DocumentImage[]> = {}): Promise<ExtractedPdfDocument> {
  const pages: ExtractedPdfPage[] = []; let usedOcr = false;
  for (let number = 1; number <= pdf.numPages; number++) {
    const pdfPage = await pdf.getPage(number); const viewport = pdfPage.getViewport({ scale: 1 });
    const content = await pdfPage.getTextContent();
    const items = content.items.filter((item): item is PdfJsTextItem => typeof item === "object" && item !== null && "str" in item && "transform" in item) as PdfJsTextItem[];
    let tokens = tokensFromPdfTextItems(items, number); let source: PdfContentSource = "text-layer";
    // A tiny invisible text layer is common in scanned PDFs; it should not
    // prevent OCR from running.
    if (tokens.map((token) => token.text).join("").replace(/\s/g, "").length < 12) {
      const result = await ocr(pdfPage, number); source = "ocr"; usedOcr = true;
      tokens = result.words.filter((word) => word.text.trim()).map((word) => ({ text: word.text.normalize("NFC").trim(), bbox: word.bbox, page: number, fontSize: word.fontSize ?? Math.max(1, word.bbox.y1 - word.bbox.y0), confidence: word.confidence, bold: word.bold, italic: word.italic, source }));
    }
    const confidence = tokens.length ? tokens.reduce((sum, token) => sum + token.confidence, 0) / tokens.length : 0;
    pages.push({ page: number, width: viewport.width, height: viewport.height, source, tokens, blocks: analyzePageLayout(tokens, imagesByPage[number]), confidence });
  }
  return { pages, usedOcr };
}

