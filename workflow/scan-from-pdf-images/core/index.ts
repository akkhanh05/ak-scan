import type { PdfGraphics, PdfTextItem } from "@/workflow/shared/core/pdf-document";

/**
 * Decides whether a PDF page carries a usable text layer ("document") or is a
 * scanned image ("scan"). Scanned PDFs often contain a hidden OCR layer made of
 * tiny fragments and single glyphs, so the layer is scored rather than trusted.
 * A page whose content is one big picture is a scan even with an OCR layer:
 * it is re-recognised with the bundled Vietnamese model instead.
 */
export function classifyPdfPage(items: PdfTextItem[], page: { width: number; height: number }, graphics?: Pick<PdfGraphics, "images">): "document" | "scan" {
  const pageArea = Math.max(1, page.width * page.height);
  if (graphics?.images.some((image) => (image.x1 - image.x0) * (image.y1 - image.y0) >= pageArea * .6)) return "scan";
  const visible = items.filter((item) => item.text.trim());
  const characters = visible.reduce((sum, item) => sum + item.text.trim().length, 0);
  if (characters < 12 || !visible.length) return "scan";
  const isolatedGlyphs = visible.filter((item) => item.text.trim().length <= 1).length;
  const averageItemLength = characters / visible.length;
  // Both areas in PDF points (the previous version divided by canvas pixels,
  // which under-counted coverage ~6x and pushed real documents towards OCR).
  const textCoverage = visible.reduce((sum, item) => sum + Math.max(0, item.width * Math.abs(item.height)), 0) / pageArea;
  const singletonRatio = isolatedGlyphs / visible.length;
  const score = .35 + Math.min(.3, averageItemLength / 20) + Math.min(.25, textCoverage * 4) - Math.min(.5, singletonRatio * .9);
  return score >= .48 ? "document" : "scan";
}

/** Image-only PDF pages go through the same scan pipeline as photos. */
export function scanFromPdfImages<T extends { pdfKind?: "document" | "scan" }>(pages: T[]) {
  return pages.filter((page) => page.pdfKind === "scan");
}
