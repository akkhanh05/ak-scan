import { chooseOcrCandidate, cleanOcrPageLines, deduplicateOcrLines, groupPdfTextItems, isSuspiciousOcrLine, joinWords, mergePositionedOcrLines, normalizeOcrText, postProcessOcrLine, recognizedTextLines, repairFragmentedOcrWords, scoreOcrCandidate, selectBestOcrLines, structureOcrDocumentLines } from "../shared/core/ocr";

let failed = 0;
function test(name: string, fn: () => void) { try { fn(); console.log(`  [PASS] ${name}`); } catch (error) { failed++; console.error(`  [FAIL] ${name}: ${(error as Error).message}`); } }
function expect(actual: unknown, expected: unknown, message: string) { if (actual !== expected) throw new Error(`${message}; expected ${String(expected)}, got ${String(actual)}`); }
const word = (text: string, confidence: number, x: number, h = 20) => ({ text, confidence, bbox: { x0: x, y0: 100, x1: x + Math.max(8, text.length * 10), y1: 100 + h } });

console.log("OCR POST-PROCESSING TESTS");
test("removes tiny inserted OCR glyphs but keeps the sentence", () => {
  const result = postProcessOcrLine({ words: [word("Today", 96, 0), word("we're", 96, 65), word("g", 28, 125, 7), word("going", 96, 140), word("home", 96, 205)] });
  expect(result.text, "Today we're going home", "noise glyph should be removed");
  expect(result.metrics.filteredNoiseCount, 1, "filtered count");
});
test("removes full-height very-low-confidence glyphs inserted inside prose", () => {
  const result = postProcessOcrLine({ words: [word("staying", 96, 0), word("up", 96, 78), word("1", 18, 110), word("late", 96, 125)] });
  expect(result.text, "staying up late", "full-height isolated artifact should be removed");
});
test("keeps legitimate one-letter English words", () => {
  const result = postProcessOcrLine({ words: [word("It", 96, 0), word("is", 96, 25), word("a", 18, 50), word("test", 96, 65)] });
  expect(result.text, "It is a test", "the article a must not be removed");
});
test("keeps legitimate numeric tokens and punctuation", () => {
  const result = postProcessOcrLine({ words: [word("If", 96, 0), word("you", 96, 30), word("sleep", 96, 70), word("at", 96, 130), word("11", 96, 160), word("p.m.", 96, 190), word(",", 40, 230, 6)] });
  expect(result.text, "If you sleep at 11 p.m.,", "time and comma must stay intact");
});
test("keeps Vietnamese diacritics and normalizes Unicode", () => {
  const result = postProcessOcrLine({ words: [word("Tiếng", 95, 0), word("Việt", 94, 65), word("rất", 95, 115), word("rõ", 96, 150)] });
  expect(result.text, "Tiếng Việt rất rõ", "Vietnamese NFC text should remain readable");
});
test("retains but flags a low-confidence real word for review", () => {
  const result = postProcessOcrLine({ words: [word("The", 96, 0), word("hidden", 42, 40), word("danger", 96, 110)] });
  expect(result.text, "The hidden danger", "low-confidence word must not be deleted");
  expect(result.words[1].flagged, true, "word should be flagged");
  expect(result.retryRegions.length, 1, "low-confidence word needs a retry region");
});
test("does not delete an isolated heading/list digit", () => {
  const result = postProcessOcrLine({ words: [word("4", 43, 0, 8), word("First", 96, 25), word("sleep", 96, 85)] });
  expect(result.text, "4 First sleep", "list digit at a line edge is meaningful");
});
test("repairs spaces around punctuation", () => {
  expect(normalizeOcrText("Hello  ,  world !"), "Hello, world!", "punctuation spacing");
  expect(joinWords([{ normalizedText: "Hello" }, { normalizedText: "," }, { normalizedText: "world" }, { normalizedText: "!" }]), "Hello, world!", "word joining");
});
test("groups positioned PDF text into lines and detects a larger heading", () => {
  const lines = groupPdfTextItems([
    { text: "TITLE", x: 10, y: 100, width: 50, height: 18, fontName: "F1", hasEol: true },
    { text: "Hello", x: 10, y: 70, width: 30, height: 10, fontName: "F2", hasEol: false },
    { text: "world.", x: 44, y: 70, width: 32, height: 10, fontName: "F2", hasEol: true },
  ]);
  expect(lines.length, 2, "line count");
  expect(lines[0].heading, true, "large text should be a heading");
  expect(lines[1].text, "Hello world.", "positioned words should keep spacing");
});

test("auto language keeps English source instead of Vietnamese-looking substitutions", () => {
  const english = { language: "eng" as const, text: "THE HIDDEN DANGERS OF STAYING UP LATE", confidence: 91 };
  const vietnamese = { language: "vie" as const, text: "CÁC ẨN NGUY HIỂM CỦ Ở LẠI LÊN MUỘN", confidence: 93 };
  expect(chooseOcrCandidate(english, vietnamese), english, "English source must remain English");
});

test("auto language keeps real Vietnamese when its recognition is clearly better", () => {
  const english = { language: "eng" as const, text: "Tai lieu huong dan su dung", confidence: 72 };
  const vietnamese = { language: "vie" as const, text: "Tài liệu hướng dẫn sử dụng", confidence: 94 };
  expect(chooseOcrCandidate(english, vietnamese), vietnamese, "Vietnamese source must retain diacritics");
});
test("auto language keeps Vietnamese marks even with a small confidence gap", () => {
  const english = { language: "eng" as const, text: "Tai lieu huong dan su dung", confidence: 91 };
  const vietnamese = { language: "vie" as const, text: "Tài liệu hướng dẫn sử dụng", confidence: 93 };
  expect(chooseOcrCandidate(english, vietnamese), vietnamese, "matching source glyphs should keep Vietnamese marks");
});
test("line merging cannot cascade until it swallows the rest of a page", () => {
  const line = (text: string, y0: number, y1: number) => ({ text, confidence: 95, bbox: { x0: 10, y0, x1: 100, y1 }, words: [word(text, 95, 10, y1 - y0)] });
  const result = mergePositionedOcrLines([line("first", 10, 20), line("fragment", 13, 23), line("second", 27, 37), line("third", 44, 54)]);
  expect(result.length, 3, "nearby fragments merge, separate baselines remain separate");
  expect(result[0].text, "first fragment", "same-line fragments merge once");
});
test("repairs a one-letter OCR fragment without joining normal words", () => {
  const repaired = repairFragmentedOcrWords([word("s", 90, 0, 10), word("ocial", 90, 12, 10), word("media", 90, 52, 10)]);
  expect(repaired.map((item) => item.text).join(" "), "social media", "only the split word should be rejoined");
});
test("repairs real scan fragments from the English sleep article", () => {
  const repaired = repairFragmentedOcrWords([
    { text: "s", confidence: 42, bbox: { x0: 100, y0: 100, x1: 108, y1: 120 } },
    { text: "ocial", confidence: 94, bbox: { x0: 110, y0: 100, x1: 160, y1: 120 } },
    { text: "media", confidence: 96, bbox: { x0: 175, y0: 100, x1: 220, y1: 120 } },
  ]);
  expect(repaired.map((word) => word.text).join(" "), "social media", "scan fragment s+ocial should be repaired");
});
test("repairs known high-confidence English scan substitutions", () => {
  expect(normalizeOcrText("ocial media. ButIn modern life. i Soon wor’ phon!e cortiso"), "social media. But In modern life. Soon work phone cortisol", "known scan substitutions should be normalized");
});
test("candidate scoring rejects visible OCR garbage despite similar confidence", () => {
  const clean = scoreOcrCandidate("Sooner or later, your body will pay a high price.", 91);
  const noisy = scoreOcrCandidate(": © P 8 er or later, i Soon your body will pay.", 92);
  expect(clean > noisy, true, "clean prose should beat a noisy higher-confidence candidate");
});
test("candidate scoring rejects long words fused by small italic OCR", () => {
  const fused = "upstoremustoperate fortwoconsecutiveweeks Setupandoperationalcosts";
  const clean = "up store must operate for two consecutive weeks. Setup and operational costs";
  expect(scoreOcrCandidate(clean, 82) > scoreOcrCandidate(fused, 88), true, "clean spaced italic line should beat a higher-confidence fused line");
});
test("selects the cleanest OCR result independently for each visual line", () => {
  const bbox = { x0: 10, y0: 10, x1: 200, y1: 30 };
  const noisy = { text: "In modern life, it’s very casy to scroll pu", confidence: 91, bbox, words: [] };
  const clean = { text: "In modern life, it’s very easy to scroll", confidence: 90, bbox, words: [] };
  expect(selectBestOcrLines([[noisy], [clean]])[0].text, clean.text, "line consensus should prefer clean prose");
  expect(isSuspiciousOcrLine(noisy.text, noisy.confidence), true, "known malformed line should be retried");
});
test("does not swap simultaneous multi-column OCR rows", () => {
  const left = { text: "Left column text", confidence: 86, bbox: { x0: 10, y0: 40, x1: 130, y1: 60 }, words: [] };
  const right = { text: "Right column text", confidence: 98, bbox: { x0: 300, y0: 40, x1: 440, y1: 60 }, words: [] };
  const alternateLeft = { ...left, text: "Clean left column text", confidence: 90 };
  const result = selectBestOcrLines([[left, right], [alternateLeft]]);
  expect(result.map((line) => line.text).join(" | "), "Clean left column text | Right column text", "candidate must only replace its matching horizontal region");
});
test("keeps a faint line discovered only by an alternate segmentation", () => {
  const heading = { text: "Exam instructions", confidence: 93, bbox: { x0: 20, y0: 10, x1: 210, y1: 32 }, words: [] };
  const faintItalic = { text: "Read every question carefully.", confidence: 75, bbox: { x0: 24, y0: 44, x1: 310, y1: 62 }, words: [] };
  const result = selectBestOcrLines([[heading], [heading, faintItalic]]);
  expect(result.map((line) => line.text).join(" | "), "Exam instructions | Read every question carefully.", "alternate-only line must not be dropped");
});
test("does not emit repeated OCR lines into searchable PDF or Word", () => {
  const line = "science shows that when you sacrifice your sleep, you create a dangerous debt. Sooner or later,";
  expect(deduplicateOcrLines([line, line, line]).join("\n"), line, "consecutive OCR duplicates must collapse to one line");
});
test("repairs the exact curved-page reading-order regression", () => {
  const cleaned = cleanOcrPageLines([
    "social media or working until midnight. ButIn modern life, it’s very easy to keep scrolling on s",
    ": © P 8 er or later,",
    "science shows that when you sacrifice your sleep, you create a dangerous debt. So",
    "Soon",
    "your body will have to pay a very high price.",
  ]);
  expect(cleaned.join("\n"), "In modern life, it’s very easy to keep scrolling on social media or working until midnight. But\nscience shows that when you sacrifice your sleep, you create a dangerous debt. Sooner or later,\nyour body will have to pay a very high price.", "curved scan should restore sentence and remove garbage lines");
});
test("filters a noise glyph after a fragmented word has been repaired", () => {
  const repaired = repairFragmentedOcrWords([
    word("s", 42, 0, 10), word("ocial", 94, 12, 10), word("g", 24, 67, 6), word("media", 96, 80, 10),
  ]);
  const cleaned = postProcessOcrLine({ words: repaired });
  expect(cleaned.text, "social media", "repair must not bypass filtering of an inserted OCR glyph");
});
test("content-first lines preserve OCR reading order without geometry", () => {
  const lines = recognizedTextLines("Hello everyone\nToday we're going to talk\n\nGoodbye!");
  expect(lines.join(" | "), "Hello everyone | Today we're going to talk | Goodbye!", "raw OCR line order must be authoritative");
});
test("structures OCR Word output instead of flattening the whole page", () => {
  const blocks = structureOcrDocumentLines([
    "PMG201c - Practical Exam 1 (Fall 2025)",
    "You have created a unique niche consumer product,",
    "and your task is to demonstrate its market viability.",
    "Request 1 (20%): write a narrative charter statement",
    "1. Project name,",
    "2. Justifications and constraints.",
    "Request 2 (20%): list five cost items.",
  ]);
  expect(blocks.length, 6, "logical paragraph count");
  expect(blocks[0].kind, "title", "first short line becomes title");
  expect(blocks[1].text, "You have created a unique niche consumer product, and your task is to demonstrate its market viability.", "wrapped prose lines merge");
  expect(blocks[2].kind, "heading", "request becomes heading");
  expect(blocks[3].kind, "list-item", "numbered item remains separate");
});
if (failed) process.exit(1);


