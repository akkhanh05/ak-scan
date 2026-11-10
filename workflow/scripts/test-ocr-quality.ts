import { editDistance, isRegression, measureOcrQuality, meetsQualityThreshold, normalizeOcrText } from "./ocr-quality";

type GoldenCase = { name: string; expected: string; actual: string; threshold: { maxCer: number; maxWer: number } };

const goldenCases: GoldenCase[] = [
  { name: "English paragraph with no inserted single-character token", expected: "Hello everyone, and welcome back to English 15 Minutes.", actual: "Hello everyone, and welcome back to English 15 Minutes.", threshold: { maxCer: 0.01, maxWer: 0.01 } },
  { name: "Vietnamese diacritics remain intact", expected: "Tiếng Việt cần giữ đầy đủ dấu sắc, huyền, hỏi, ngã, nặng.", actual: "Tiếng Việt cần giữ đầy đủ dấu sắc, huyền, hỏi, ngã, nặng.", threshold: { maxCer: 0.01, maxWer: 0.01 } },
  { name: "Numbers and punctuation remain legitimate content", expected: "If you sleep after 11 p.m., your body needs rest.", actual: "If you sleep after 11 p.m., your body needs rest.", threshold: { maxCer: 0.01, maxWer: 0.01 } },
  { name: "Known noisy scan must reject spurious token regression", expected: "Today we're going to talk about a silent killer.", actual: "Today we're going to talk about a silent killer.", threshold: { maxCer: 0.02, maxWer: 0.02 } },
];

let failures = 0;
function check(condition: boolean, message: string) {
  if (!condition) { failures++; console.error(`  [FAIL] ${message}`); } else console.log(`  [PASS] ${message}`);
}

console.log("OCR QUALITY REGRESSION SUITE\n");
check(normalizeOcrText("  Tiếng\nViệt  ") === "Tiếng Việt", "normalizes whitespace without removing Vietnamese marks");
check(editDistance(Array.from("scan"), Array.from("span")) === 1, "computes character edit distance");
for (const sample of goldenCases) {
  const quality = measureOcrQuality(sample.expected, sample.actual);
  check(meetsQualityThreshold(quality, sample.threshold), `${sample.name} (CER ${(quality.cer * 100).toFixed(2)}%, WER ${(quality.wer * 100).toFixed(2)}%)`);
}
const expected = "Today we're going to talk about a silent killer.";
const clean = measureOcrQuality(expected, expected);
const noisy = measureOcrQuality(expected, "Today we're going to talk about a l silent killer.");
check(noisy.wordErrors === 1, "counts an inserted standalone OCR artifact as one word error");
check(isRegression(clean, noisy), "flags a spurious standalone token as a regression");
check(!isRegression(noisy, clean), "accepts an OCR improvement");
console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${goldenCases.length + 5} OCR quality checks`);
if (failures > 0) process.exit(1);


