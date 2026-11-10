/** Export options shared by the dialog and every exporter, with one meaning each. */

export type PageSize = "a4" | "letter" | "fit";
export type PageMargin = "none" | "small" | "large";
export type ExportQuality = "compact" | "balanced" | "high";
export type ExportFormat = "pdf" | "docx";
/** Tesseract page segmentation: automatic (handles columns), one column, or sparse text/forms. */
export type OcrLayout = "auto" | "single-column" | "sparse";
export type WordMode = "editable" | "preserve-layout";

export interface ExportOptions {
  format: ExportFormat;
  pageSize: PageSize;
  margin: PageMargin;
  quality: ExportQuality;
  /** PDF only: add an invisible, selectable text layer. */
  searchable: boolean;
  ocrLayout: OcrLayout;
  wordMode: WordMode;
  /** Show recognised text for checking before the file is built. */
  reviewText: boolean;
}

export const defaultExportOptions: ExportOptions = {
  format: "pdf",
  pageSize: "a4",
  margin: "small",
  quality: "balanced",
  searchable: false,
  ocrLayout: "auto",
  wordMode: "editable",
  reviewText: true,
};

/** Distance from the paper edge to the content, identical for PDF and Word. */
export const MARGIN_MM: Record<PageMargin, number> = { none: 0, small: 8, large: 15 };

export const PAGE_SIZES_PT: Record<Exclude<PageSize, "fit">, readonly [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export const QUALITY_PROFILES: Record<ExportQuality, { maxEdge: number; jpegQuality: number }> = {
  compact: { maxEdge: 1800, jpegQuality: .82 },
  balanced: { maxEdge: 3200, jpegQuality: .93 },
  high: { maxEdge: 4800, jpegQuality: .98 },
};

/** Long edge used for "fit" pages: the long edge of A4. */
export const FIT_LONG_EDGE_PT = 841.89;

export function mmToPoints(mm: number) { return mm / 25.4 * 72; }

/**
 * Sheet size in points for content of the given aspect ratio. Standard sizes
 * turn to landscape for landscape content, as a scanner driver would.
 */
export function sheetSize(pageSize: PageSize, contentWidth: number, contentHeight: number): [number, number] {
  const landscape = contentWidth > contentHeight;
  if (pageSize === "fit") {
    const scale = FIT_LONG_EDGE_PT / Math.max(contentWidth, contentHeight);
    return [contentWidth * scale, contentHeight * scale];
  }
  const [short, long] = PAGE_SIZES_PT[pageSize];
  return landscape ? [long, short] : [short, long];
}

export function pageSegmentationMode(layout: OcrLayout): "3" | "4" | "11" {
  return layout === "single-column" ? "4" : layout === "sparse" ? "11" : "3";
}
