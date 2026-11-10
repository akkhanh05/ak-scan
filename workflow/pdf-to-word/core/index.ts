import type { ScanPage } from "@/workflow/shared/core/scan";

/** Domain contract for text-based PDF → editable Word. */
export function pdfToWord(pages: ScanPage[]) {
  return { kind: "pdf-to-word" as const, pages, requiresOcr: pages.some((page) => page.pdfKind === "scan" || !page.embeddedText) };
}

