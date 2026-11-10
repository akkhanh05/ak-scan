/** Workflow boundary. Each workflow owns its decisions; shared primitives live in shared/core. */
export { scanFromImage, shouldApplyDetectedCrop, AUTO_CROP_CONFIDENCE } from "./scan-from-image/core";
export { scanFromPdfImages, classifyPdfPage } from "./scan-from-pdf-images/core";
export { pdfToWord } from "./pdf-to-word/core";
