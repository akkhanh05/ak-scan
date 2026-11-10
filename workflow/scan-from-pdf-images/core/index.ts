import type { ScanPage } from "@/workflow/shared/core/scan";

/** Domain contract for image-only PDF input. */
export function scanFromPdfImages(pages: ScanPage[]) {
  return { kind: "scan-from-pdf-images" as const, pages, requiresOcrForWord: pages.some((page) => page.pdfKind === "scan") };
}

