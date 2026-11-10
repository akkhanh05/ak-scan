/**
 * Real OCR accuracy with the bundled models and the production language
 * configuration, on synthetic Vietnamese/English pages (clean 300 dpi scans and
 * degraded "phone photo" versions). Fails when accuracy regresses.
 *
 * Fixtures: workflow/scripts/fixtures/ocr/{vi,en}.html are the sources; the
 * images were rendered with LibreOffice + pdftoppm and degraded with
 * ImageMagick (resize 66%, rotate 1.3°, blur 0.9, Gaussian noise, JPEG 70).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createWorker } from "tesseract.js";
import { OCR_LANGUAGES } from "../shared/core/ocr-config";
import { measureOcrQuality, meetsQualityThreshold } from "./ocr-quality";

const root = join(__dirname, "..", "..");
const fixtures = join(__dirname, "fixtures", "ocr");
const cases = [
  { image: "vi-clean.png", truth: "vi.txt", maxCer: .01, maxWer: .03 },
  { image: "vi-photo.jpg", truth: "vi.txt", maxCer: .015, maxWer: .04 },
  { image: "en-clean.png", truth: "en.txt", maxCer: .01, maxWer: .03 },
  { image: "en-photo.jpg", truth: "en.txt", maxCer: .015, maxWer: .04 },
];

async function main() {
  console.log(`OCR ACCURACY (${OCR_LANGUAGES}, bundled best_int models)`);
  const worker = await createWorker(OCR_LANGUAGES, 1, { langPath: join(root, "public", "tessdata"), gzip: true, cacheMethod: "none" });
  await worker.setParameters({ tessedit_pageseg_mode: "3" as never, preserve_interword_spaces: "1" });
  let failures = 0;
  try {
    for (const sample of cases) {
      const started = Date.now();
      const { data } = await worker.recognize(join(fixtures, sample.image));
      const quality = measureOcrQuality(readFileSync(join(fixtures, sample.truth), "utf8"), data.text);
      const ok = meetsQualityThreshold(quality, sample);
      if (!ok) failures++;
      console.log(`  [${ok ? "PASS" : "FAIL"}] ${sample.image.padEnd(13)} CER ${(quality.cer * 100).toFixed(2)}% (≤ ${sample.maxCer * 100}%) · WER ${(quality.wer * 100).toFixed(2)}% (≤ ${sample.maxWer * 100}%) · ${Date.now() - started} ms`);
    }
  } finally {
    await worker.terminate();
  }
  if (failures) { console.error(`\n${failures} OCR accuracy check(s) failed`); process.exit(1); }
  console.log("\nPASS: OCR accuracy");
}

void main();
