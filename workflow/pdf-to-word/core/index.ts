import { hasTextLayer } from "@/workflow/shared/core/export-pipeline";
import type { ScanPage } from "@/workflow/shared/core/scan";

/**
 * Text-layer PDF → editable Word. Pages with a usable text layer are rebuilt
 * from it (no OCR); every other page in the same export is recognised.
 */
export function pdfToWord(pages: ScanPage[]) {
  const textLayerPages = pages.filter(hasTextLayer);
  return { kind: "pdf-to-word" as const, textLayerPages, ocrPages: pages.filter((page) => !hasTextLayer(page)) };
}
