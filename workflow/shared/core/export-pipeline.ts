/**
 * Export orchestration shared by every output. Rendering, OCR, cropping and
 * font loading are injected so the whole flow can run in Node tests with fakes
 * and in the browser with the render worker and Tesseract.
 */
import type { PageContent, Rect } from "./document-model";
import { layoutOcrPage } from "./ocr-structure";
import type { OcrTableGrid } from "./ocr-structure";
import { cleanPositionedLine, isSuspiciousOcrLine, positionedLinesFromResult, recognizedTextLines, scoreOcrCandidate, selectBestOcrLines } from "./ocr";
import type { PositionedOcrLine } from "./ocr";
import { layoutTextLayerPage } from "./pdf-document";
import { isDefaultCrop, mapSourceToRendered } from "./page-geometry";
import type { RenderOutput, RenderResult } from "./render-protocol";
import { ocrPreprocessFilters } from "./scan";
import type { RenderablePage, ScanPage } from "./scan";
import { PAGE_SIZES_PT, QUALITY_PROFILES, pageSegmentationMode } from "./export-options";
import type { ExportOptions } from "./export-options";
import type { PdfPageInput, PdfTextLine } from "./export/pdf";

type OcrBox = { x0: number; y0: number; x1: number; y1: number };
export interface OcrResultLike {
  data: {
    text: string;
    confidence: number;
    blocks?: Array<{ paragraphs: Array<{ lines: Array<{ text: string; confidence: number; bbox: OcrBox; words?: Array<{ text: string; confidence: number; bbox: OcrBox }> }> }> }> | null;
  };
}

export interface OcrLine extends PositionedOcrLine { flaggedWords: number }
export interface PageOcr { pageId: string; width: number; height: number; lines: OcrLine[]; grid: OcrTableGrid | null }

export type ExportStage = "render" | "ocr" | "layout" | "package";
export interface PipelineDeps {
  render(page: RenderablePage, maxEdge: number, output: RenderOutput, options?: { detectGrid?: boolean }): Promise<RenderResult>;
  recognize?(request: { image: Blob; psm: "3" | "4" | "6" | "7" | "11"; rectangle?: { left: number; top: number; width: number; height: number } }): Promise<OcrResultLike>;
  /** PNG bytes of a region of the page's source image, given in PDF points. */
  cropSource?(page: ScanPage, rect: Rect): Promise<Uint8Array | undefined>;
  progress?(event: { stage: ExportStage; done: number; total: number; page?: number }): void;
  /** Throws an AbortError when the user cancelled. */
  checkCancelled(): void;
}

/** OCR renders at roughly 300 dpi for an A4 page. */
export const OCR_MAX_EDGE = 3200;

export function hasTextLayer(page: ScanPage) {
  return page.pdfKind === "document" && Boolean(page.pdfPage?.items.length);
}

export function pagesNeedingOcr(pages: ScanPage[], options: ExportOptions) {
  if (options.format === "pdf" && !options.searchable) return [];
  return pages.filter((page) => !hasTextLayer(page));
}

function blobFrom(result: RenderResult) {
  if (!result.bytes) throw new Error("Không dựng được ảnh trang để nhận diện chữ.");
  return new Blob([result.bytes], { type: result.mime ?? "image/png" });
}

function ocrPreset(page: ScanPage, filter: "grayscale" | "enhanced" | "bw"): RenderablePage {
  return {
    ...page,
    settings: {
      ...page.settings,
      filter,
      removeShadow: Math.max(42, page.settings.removeShadow),
      whiten: Math.max(24, page.settings.whiten),
      sharpen: Math.min(22, page.settings.sharpen),
    },
  };
}

/**
 * Recognises one page: several image preparations and segmentation modes are
 * compared line by line, suspicious lines are re-read on their own, and every
 * line keeps its position for the searchable PDF and the Word structure.
 */
export async function recognizePage(page: ScanPage, options: Pick<ExportOptions, "ocrLayout">, deps: PipelineDeps): Promise<PageOcr> {
  if (!deps.recognize) throw new Error("Thiếu bộ nhận diện chữ.");
  const psm = pageSegmentationMode(options.ocrLayout);
  deps.checkCancelled();
  const primary = await deps.render(ocrPreset(page, "grayscale"), OCR_MAX_EDGE, { kind: "png" }, { detectGrid: true });
  const primaryBlob = blobFrom(primary);
  const first = await deps.recognize({ image: primaryBlob, psm });
  const candidates: PositionedOcrLine[][] = [positionedLinesFromResult(first.data, "primary")];
  let bestConfidence = first.data.confidence;

  for (const filter of ocrPreprocessFilters(first.data.confidence).slice(1)) {
    deps.checkCancelled();
    const variant = await deps.render(ocrPreset(page, filter), OCR_MAX_EDGE, { kind: "png" });
    const result = await deps.recognize({ image: blobFrom(variant), psm });
    candidates.push(positionedLinesFromResult(result.data, filter));
    bestConfidence = Math.max(bestConfidence, result.data.confidence);
  }
  if (bestConfidence < 96) {
    deps.checkCancelled();
    const block = await deps.recognize({ image: primaryBlob, psm: "6" });
    candidates.push(positionedLinesFromResult(block.data, "block"));
  }

  const lines = selectBestOcrLines(candidates);
  // Whole-page modes keep reading order; a single-line pass (PSM 7) is better
  // for one faint, italic or tightly spaced row. Re-read only those rows.
  for (const line of lines.filter((candidate) => isSuspiciousOcrLine(candidate.text, candidate.confidence)).slice(0, 10)) {
    deps.checkCancelled();
    const padding = Math.max(10, Math.round((line.bbox.y1 - line.bbox.y0) * .6));
    const left = Math.max(0, Math.floor(line.bbox.x0 - padding));
    const top = Math.max(0, Math.floor(line.bbox.y0 - padding));
    const right = Math.min(primary.width ?? line.bbox.x1 + padding, Math.ceil(line.bbox.x1 + padding));
    const bottom = Math.min(primary.height ?? line.bbox.y1 + padding, Math.ceil(line.bbox.y1 + padding));
    const retry = await deps.recognize({ image: primaryBlob, psm: "7", rectangle: { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) } });
    const retryText = recognizedTextLines(retry.data.text).join(" ");
    // A single-line re-read must still describe the same line: reject results
    // that are much longer/shorter (a drifted rectangle can pick up neighbours).
    const plausible = retryText.length >= line.text.length * .5 && retryText.length <= line.text.length * 1.6 + 4;
    if (retryText && plausible && scoreOcrCandidate(retryText, retry.data.confidence) > scoreOcrCandidate(line.text, line.confidence)) {
      line.text = retryText;
      line.confidence = retry.data.confidence;
      line.words = [];
    }
  }

  return {
    pageId: page.id,
    width: primary.width ?? 1,
    height: primary.height ?? 1,
    lines: lines.map(cleanPositionedLine).filter((line) => line.text),
    grid: primary.grid && primary.grid.xLines.length >= 3 && primary.grid.yLines.length >= 3 ? primary.grid : null,
  };
}

/** Recognises pages concurrently (one page per OCR worker). */
export async function recognizePages(pages: ScanPage[], options: Pick<ExportOptions, "ocrLayout">, deps: PipelineDeps, concurrency = 1) {
  const results = new Map<string, PageOcr>();
  let next = 0, done = 0;
  deps.progress?.({ stage: "ocr", done: 0, total: pages.length });
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, pages.length)) }, async () => {
    while (next < pages.length) {
      const index = next++;
      let result: PageOcr;
      try {
        result = await recognizePage(pages[index], options, deps);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        // Name the page so the user knows which one to retake or crop.
        throw new Error(`Trang ${index + 1} (${pages[index].name}): ${error instanceof Error ? error.message : "không nhận diện được chữ."}`);
      }
      results.set(pages[index].id, result);
      deps.progress?.({ stage: "ocr", done: ++done, total: pages.length, page: index + 1 });
    }
  });
  await Promise.all(workers);
  return results;
}

/** Applies the user's corrections from the review step (line text only). */
export function applyOcrCorrections(ocr: PageOcr, corrections: string[]): PageOcr {
  return {
    ...ocr,
    lines: ocr.lines.map((line, index) => {
      const corrected = corrections[index];
      if (corrected === undefined || corrected === line.text) return line;
      return { ...line, text: corrected.trim(), words: [], confidence: 100, flaggedWords: 0 };
    }).filter((line) => line.text),
  };
}

function cropPolygon(page: ScanPage) {
  if (!page.pdfPage || isDefaultCrop(page.corners)) return undefined;
  return page.corners.map((point) => ({ x: point.x * page.pdfPage!.width, y: point.y * page.pdfPage!.height }));
}

/** Builds the document model of every page (text layer or OCR). */
export async function buildPageContents(pages: ScanPage[], ocr: Map<string, PageOcr>, deps: PipelineDeps): Promise<PageContent[]> {
  const contents: PageContent[] = [];
  for (const [index, page] of pages.entries()) {
    deps.checkCancelled();
    if (hasTextLayer(page)) {
      const pdf = page.pdfPage!;
      const content = layoutTextLayerPage(pdf.items, pdf.graphics, { width: pdf.width, height: pdf.height }, { crop: cropPolygon(page) });
      for (const block of content.blocks) {
        if (block.kind === "image" && deps.cropSource) block.data = await deps.cropSource(page, block.bbox);
      }
      contents.push(content);
    } else {
      const result = ocr.get(page.id);
      if (!result) throw new Error(`Thiếu kết quả nhận diện chữ của trang ${index + 1}.`);
      const [short, long] = PAGE_SIZES_PT.a4;
      const scale = (result.width > result.height ? long : short) / result.width;
      contents.push(layoutOcrPage(result.lines, result, { scale, grid: result.grid }));
    }
    deps.progress?.({ stage: "layout", done: index + 1, total: pages.length });
  }
  return contents;
}

/** Text-layer items mapped onto the rendered (cropped/rotated) page image. */
export function textLayerLines(page: ScanPage, output: { width: number; height: number }): PdfTextLine[] {
  const pdf = page.pdfPage;
  if (!pdf) return [];
  const geometry = { corners: page.corners, rotation: page.rotation, fineRotation: page.fineRotation ?? 0 };
  return pdf.items.flatMap((item) => {
    if (!item.text.trim() || item.width <= 0) return [];
    const left = mapSourceToRendered({ x: item.x / pdf.width, y: 1 - item.y / pdf.height }, geometry, output);
    const right = mapSourceToRendered({ x: (item.x + item.width) / pdf.width, y: 1 - item.y / pdf.height }, geometry, output);
    const width = Math.hypot(right.x - left.x, right.y - left.y);
    if (left.x < -2 || left.y < -2 || left.x > output.width + 2 || left.y > output.height + 2 || width < 1) return [];
    return [{
      text: item.text,
      x: left.x,
      baseline: left.y,
      width,
      size: Math.abs(item.height) * width / item.width,
      angle: -Math.atan2(right.y - left.y, right.x - left.x) * 180 / Math.PI,
    }];
  });
}

/** OCR lines scaled from the OCR render to the exported image. */
export function ocrTextLines(ocr: PageOcr, output: { width: number; height: number }): PdfTextLine[] {
  const ratio = output.width / Math.max(1, ocr.width);
  return ocr.lines.map((line) => {
    const height = Math.max(1, line.bbox.y1 - line.bbox.y0) * ratio;
    return { text: line.text, x: line.bbox.x0 * ratio, baseline: line.bbox.y1 * ratio - height * .22, width: Math.max(1, line.bbox.x1 - line.bbox.x0) * ratio, size: height / 1.2 };
  });
}

/** Renders the export images and attaches the searchable text where requested. */
export async function buildPdfPages(pages: ScanPage[], ocr: Map<string, PageOcr> | null, options: ExportOptions, deps: PipelineDeps): Promise<PdfPageInput[]> {
  const profile = QUALITY_PROFILES[options.quality];
  const inputs: PdfPageInput[] = [];
  for (const [index, page] of pages.entries()) {
    deps.checkCancelled();
    const bilevel = page.settings.filter === "bw";
    const rendered = await deps.render(page, profile.maxEdge, bilevel ? { kind: "bilevel" } : { kind: "jpeg", quality: profile.jpegQuality });
    const size = { width: rendered.width ?? 1, height: rendered.height ?? 1 };
    const image: PdfPageInput["image"] = bilevel
      ? { kind: "bilevel", bits: new Uint8Array(rendered.bits!), ...size }
      : { kind: "jpeg", bytes: new Uint8Array(rendered.bytes!), ...size };
    let text: PdfTextLine[] | undefined;
    if (options.searchable) {
      const recognised = ocr?.get(page.id);
      text = hasTextLayer(page) ? textLayerLines(page, size) : recognised ? ocrTextLines(recognised, size) : undefined;
    }
    inputs.push({ image, text });
    deps.progress?.({ stage: "render", done: index + 1, total: pages.length, page: index + 1 });
  }
  return inputs;
}

/** Local calendar date for file names (the UTC date can be "tomorrow" in Vietnam). */
export function exportFileName(prefix: string, extension: string, date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${prefix}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.${extension}`;
}

