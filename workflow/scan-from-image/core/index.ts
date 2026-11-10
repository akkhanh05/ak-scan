import type { ScanPage } from "@/workflow/shared/core/scan";

/** Domain contract for phone-photo input. The workspace owns the browser UI. */
export function scanFromImage(pages: ScanPage[]) {
  return { kind: "scan-from-image" as const, pages, requiresOcrForWord: pages.length > 0 };
}

