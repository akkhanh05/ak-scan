import type { DetectionResult } from "@/workflow/shared/core/scan";

/** Confidence from which an automatically detected crop is applied without asking. */
export const AUTO_CROP_CONFIDENCE = .58;

/** Photos are auto-cropped on import only when the detector is confident. */
export function shouldApplyDetectedCrop(detection: DetectionResult | undefined) {
  return Boolean(detection && detection.confidence >= AUTO_CROP_CONFIDENCE);
}

/** Phone photo → scanned page. Returns the photo pages of a session. */
export function scanFromImage<T extends { pdfKind?: "document" | "scan" }>(pages: T[]) {
  return pages.filter((page) => !page.pdfKind);
}
