/** OCR post-processing and structure tests: content integrity comes first. */
import {
  cleanPositionedLine, deduplicatePositionedLines, isSuspiciousOcrLine, joinWords, normalizeOcrText, positionedLinesFromResult,
  postProcessOcrLine, recognizedTextLines, repairFragmentedOcrWords, scoreOcrCandidate, selectBestOcrLines,
} from "../shared/core/ocr";
import type { PositionedOcrLine } from "../shared/core/ocr";
import { layoutOcrPage } from "../shared/core/ocr-structure";
import type { ParagraphBlock, TableBlock } from "../shared/core/document-model";
import { plainText } from "../shared/core/document-model";

let failed = 0;
function test(name: string, fn: () => void) { try { fn(); console.log(`  [PASS] ${name}`); } catch (error) { failed++; console.error(`  [FAIL] ${name}: ${(error as Error).message}`); } }
function expect(actual: unknown, expected: unknown, message: string) { if (actual !== expected) throw new Error(`${message}; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
const word = (text: string, confidence: number, x: number, h = 20, y = 100) => ({ text, confidence, bbox: { x0: x, y0: y, x1: x + Math.max(8, text.length * 10), y1: y + h } });
const line = (text: string, y: number, x0 = 10, x1 = 400, confidence = 95, paragraphKey?: string): PositionedOcrLine => ({ text, confidence, bbox: { x0, y0: y, x1, y1: y + 20 }, words: [], paragraphKey });

console.log("OCR INTEGRITY TESTS");

test("a repeated line at a different position is kept (e.g. two equal totals)", () => {
  const lines = deduplicatePositionedLines([line("Tổng cộng: 100.000", 100), line("Tổng cộng: 100.000", 140)]);
  expect(lines.length, 2, "both totals must survive");
});
test("the same line read twice at the same position collapses to one", () => {
  expect(deduplicatePositionedLines([line("Tổng cộng: 100.000", 100), line("Tổng cộng: 100.000", 102)]).length, 1, "duplicate pass must collapse");
});
test("multi-pass selection keeps legitimately repeated rows", () => {
  const passA = [line("Tổng cộng: 100.000", 100, 10, 400, 93), line("Tổng cộng: 100.000", 140, 10, 400, 93)];
  const passB = [line("Tổng cộng: 100.000", 101, 10, 400, 95), line("Tổng cộng: 100.000", 141, 10, 400, 95)];
  expect(selectBestOcrLines([passA, passB]).length, 2, "two rows in, two rows out");
});
test("tall Vietnamese line boxes never let the next line replace this one", () => {
  // Line pitch 33 px, boxes 32 px tall (diacritics): neighbours almost touch.
  const tall = (text: string, y: number, confidence: number): PositionedOcrLine => ({ text, confidence, bbox: { x0: 10, y0: y, x1: 900, y1: y + 32 }, words: [] });
  const passA = [tall("Hôm nay, ngày 10 tháng 11 năm 2026, chúng tôi gồm", 100, 90), tall("có đại diện bên giao và bên nhận.", 133, 90)];
  const passB = [tall("Hôm nay, ngày 10 tháng 11 năm 2026, chúng tôi gồm", 101, 91), tall("có đại diện bên giao và bên nhận.", 134, 99)];
  const result = selectBestOcrLines([passA, passB]);
  expect(result.map((item) => item.text).join(" | "), "Hôm nay, ngày 10 tháng 11 năm 2026, chúng tôi gồm | có đại diện bên giao và bên nhận.", "both lines, in order");
});
test("text is never rewritten by dictionary or sample-specific rules", () => {
  for (const sample of ["Chapter i Soon after", "the wor' is", "ocial", "phon!e", "cortiso", "ButIn"]) expect(normalizeOcrText(sample), sample, "word substitution");
});
test("normalisation only fixes whitespace and punctuation spacing", () => {
  expect(normalizeOcrText("Hello  ,  world !"), "Hello, world!", "punctuation spacing");
  expect(joinWords([{ normalizedText: "Hello" }, { normalizedText: "," }, { normalizedText: "world" }]), "Hello, world", "word joining");
  expect(normalizeOcrText("  Tiếng\tViệt  "), "Tiếng Việt", "Vietnamese marks kept");
});
test("Vietnamese one-letter words are not scored as noise", () => {
  const withSingles = scoreOcrCandidate("Tôi ở nhà và có ý kiến rằng á", 90);
  const withoutSingles = scoreOcrCandidate("Tôi đang nhà và có kiến rằng nhé", 90);
  expect(Math.abs(withSingles - withoutSingles) < .1, true, `scores ${withSingles} vs ${withoutSingles}`);
});
test("symbol specks still lower a candidate's score", () => {
  expect(scoreOcrCandidate("Sổ tay hướng dẫn | © sử dụng", 90) < scoreOcrCandidate("Sổ tay hướng dẫn sử dụng", 90), true, "noise penalty");
});
test("digits are never deleted: a low-confidence digit is flagged for review", () => {
  const result = postProcessOcrLine({ words: [word("staying", 96, 0), word("up", 96, 78), word("1", 18, 110), word("late", 96, 125)] });
  expect(result.text, "staying up 1 late", "digit kept");
  expect(result.words[2].flagged, true, "digit flagged");
});
test("a tiny low-confidence stray letter between words is removed", () => {
  const result = postProcessOcrLine({ words: [word("Today", 96, 0), word("we're", 96, 65), word("g", 28, 125, 7), word("going", 96, 140)] });
  expect(result.text, "Today we're going", "speck removed");
});
test("real one-letter words survive even with low confidence", () => {
  expect(postProcessOcrLine({ words: [word("It", 96, 0), word("is", 96, 25), word("a", 18, 50, 8), word("test", 96, 65)] }).text, "It is a test", "English a");
  expect(postProcessOcrLine({ words: [word("Tôi", 96, 0), word("ở", 20, 40, 8), word("nhà", 96, 60)] }).text, "Tôi ở nhà", "Vietnamese ở");
});
test("fragment repair joins s+ocial but never a Vietnamese one-letter word", () => {
  expect(repairFragmentedOcrWords([word("s", 90, 0, 10), word("ocial", 90, 12, 10), word("media", 90, 70, 10)]).map((item) => item.text).join(" "), "social media", "split word");
  expect(repairFragmentedOcrWords([word("ở", 90, 0, 10), word("nhà", 90, 12, 10)]).map((item) => item.text).join(" "), "ở nhà", "ở stays separate");
});
test("numbers alone are not treated as suspicious when confidence is high", () => {
  expect(isSuspiciousOcrLine("3 436,0 10 1.543 7 1.052", 95), false, "numeric row");
  expect(isSuspiciousOcrLine("Hợp | đồng", 95), true, "pipe noise");
});
test("multi-column anchor order is kept (columns are not interleaved)", () => {
  const left1 = line("Left one", 10, 10, 130, 90), left2 = line("Left two", 40, 10, 130, 90);
  const right1 = line("Right one", 10, 300, 440, 95), right2 = line("Right two", 40, 300, 440, 95);
  const result = selectBestOcrLines([[left1, left2, right1, right2]]);
  expect(result.map((item) => item.text).join(" | "), "Left one | Left two | Right one | Right two", "reading order");
});
test("a faint row found only by another pass is inserted after its neighbour", () => {
  const heading = line("Exam instructions", 10, 20, 210, 93);
  const faint = line("Read every question carefully.", 44, 24, 310, 75);
  const result = selectBestOcrLines([[heading], [heading, faint]]);
  expect(result.map((item) => item.text).join(" | "), "Exam instructions | Read every question carefully.", "residual kept");
});
test("content-first fallback keeps single-digit lines", () => {
  expect(recognizedTextLines("Trang\n5\n|\nKết thúc").join(" | "), "Trang | 5 | Kết thúc", "digits are content");
});
test("cleanPositionedLine counts uncertain words for the review step", () => {
  const cleaned = cleanPositionedLine({ text: "Số tiền 1.250.000", confidence: 80, bbox: { x0: 0, y0: 0, x1: 300, y1: 20 }, words: [word("Số", 95, 0, 20, 0), word("tiền", 95, 40, 20, 0), word("1.250.000", 60, 100, 20, 0)] });
  expect(cleaned.text, "Số tiền 1.250.000", "text intact");
  expect(cleaned.flaggedWords, 1, "one uncertain word");
});
test("positioned lines remember their Tesseract paragraph", () => {
  const data = { blocks: [{ paragraphs: [
    { lines: [{ text: "A b", confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }] },
    { lines: [{ text: "C d", confidence: 90, bbox: { x0: 0, y0: 20, x1: 10, y1: 30 } }] },
  ] }] };
  const lines = positionedLinesFromResult(data, "p");
  expect(lines[0].paragraphKey === lines[1].paragraphKey, false, "different paragraphs");
});

console.log("\nOCR → DOCUMENT STRUCTURE");
const page = { width: 1000, height: 1400 };
test("paragraph breaks follow Tesseract paragraphs and vertical gaps", () => {
  const content = layoutOcrPage([
    line("Đoạn một dòng thứ nhất rất dài và chạm lề phải của cột", 100, 50, 950, 95, "p:0:0"),
    line("đoạn một dòng thứ hai.", 125, 50, 500, 95, "p:0:0"),
    line("Đoạn hai bắt đầu sau một khoảng trắng lớn và chạm lề phải", 200, 50, 950, 95, "p:0:1"),
    line("đoạn hai kết thúc.", 225, 50, 420, 95, "p:0:1"),
  ], page, { scale: .6 });
  const paragraphs = content.blocks.filter((block) => block.kind === "paragraph") as ParagraphBlock[];
  expect(paragraphs.length, 2, "two paragraphs");
  expect(plainText(paragraphs[0].runs), "Đoạn một dòng thứ nhất rất dài và chạm lề phải của cột đoạn một dòng thứ hai.", "wrapped lines joined");
});
test("hyphenated codes split across lines stay intact", () => {
  const content = layoutOcrPage([line("Mã hàng SS6960-", 100, 50, 950, 95, "k"), line("Phantom", 125, 50, 300, 95, "k")], page, { scale: .6 });
  expect(plainText((content.blocks[0] as ParagraphBlock).runs), "Mã hàng SS6960-Phantom", "no space after hyphen");
});
test("numbered lines become list items and taller lines become headings", () => {
  const content = layoutOcrPage([
    { ...line("ĐIỀU KHOẢN CHUNG", 60, 300, 700), bbox: { x0: 300, y0: 60, x1: 700, y1: 100 } },
    line("1. Bên A giao hàng đúng hạn.", 150, 50, 600, 95, "a"),
    line("2. Bên B thanh toán đủ.", 180, 50, 560, 95, "b"),
  ], page, { scale: .6 });
  expect(content.blocks[0].kind, "title", "first tall line is the title");
  const items = content.blocks.filter((block) => block.kind === "list-item") as ParagraphBlock[];
  expect(items.length, 2, "two list items");
  expect(items[0].listType, "ordered", "numbered list");
  expect(plainText(items[0].runs), "Bên A giao hàng đúng hạn.", "marker removed from text, kept as numbering");
});
test("a detected grid becomes a table with words in their cells", () => {
  const cell = (text: string, x: number, y: number): PositionedOcrLine => ({ text, confidence: 95, bbox: { x0: x, y0: y, x1: x + 60, y1: y + 20 }, words: [{ text, confidence: 95, bbox: { x0: x, y0: y, x1: x + 60, y1: y + 20 } }] });
  const content = layoutOcrPage([line("Bảng kê", 20, 50, 300), cell("STT", 110, 110), cell("Số lượng", 310, 110), cell("1", 110, 160), cell("164", 310, 160)], page, { scale: .6, grid: { xLines: [100, 300, 500], yLines: [100, 150, 200] } });
  const table = content.blocks.find((block) => block.kind === "table") as TableBlock;
  expect(Boolean(table), true, "table present");
  expect(table.rows.map((row) => row.map((item) => plainText(item.runs)).join("|")).join(" / "), "STT|Số lượng / 1|164", "cells");
});

if (failed) { console.error(`\n${failed} OCR test(s) failed`); process.exit(1); }
console.log("\nPASS: OCR tests");
