/**
 * OCR model selection (measured in workflow/scripts/test-ocr-accuracy.ts):
 *  - "Vietnamese" is Tesseract's script model for Vietnamese (tessdata, LSTM
 *    int8). On Vietnamese pages it halved the character error rate of the
 *    language model "vie" and keeps upper-case diacritics.
 *  - "eng" (tessdata_best → int8, "best_int") keeps English accuracy.
 *  - Float "tessdata_best" models cannot run in tesseract.js 7 (its WASM core
 *    has no float dot-product), so best_int is the most accurate usable build.
 */
export const OCR_LANGUAGES = "Vietnamese+eng";
/** Bump when public/tessdata changes so browsers ignore the cached copy. */
export const OCR_ASSET_VERSION = "2026-11-best-int-1";
export const OCR_MODEL_FILES = ["Vietnamese.traineddata.gz", "eng.traineddata.gz"] as const;
