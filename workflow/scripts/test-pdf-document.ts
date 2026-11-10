import { analyzePageLayout, extractPdfDocument, mergeDocumentParagraphs, tokensFromPdfTextItems } from "../shared/core/pdf-document";

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) { try { await fn(); console.log(`  [PASS] ${name}`); } catch (error) { failed++; console.error(`  [FAIL] ${name}: ${(error as Error).message}`); } }
function expect(value: unknown, expected: unknown, message: string) { if (value !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(value)}`); }
const item = (str: string, x: number, y: number, size = 12) => ({ str, width: str.length * 6, transform: [1, 0, 0, size, x, y], fontName: "Arial" });

async function main() {
console.log("PDF DOCUMENT CORE TESTS");
await test("keeps PDF text-layer geometry and font size", () => {
  const tokens = tokensFromPdfTextItems([item("Heading", 20, 700, 20), item("body", 20, 660)], 1);
  expect(tokens[0].page, 1, "page"); expect(tokens[0].fontSize, 20, "font size"); expect(tokens[0].bbox.x0, 20, "x position");
  const blocks = analyzePageLayout(tokens); expect(blocks[0].kind, "heading", "large text becomes heading");
});
await test("recognizes aligned text as a table", () => {
  const tokens = tokensFromPdfTextItems([item("Name", 20, 700), item("Score", 180, 700), item("An", 20, 670), item("9", 180, 670)], 1);
  expect(analyzePageLayout(tokens).some((block) => block.kind === "table"), true, "aligned rows form table");
});
await test("merges wrapped PDF lines into a real Word paragraph", () => {
  const tokens = tokensFromPdfTextItems([
    item("This is the first visual line", 20, 700),
    item("and this is its wrapped continuation.", 20, 684),
    item("A new paragraph starts after a larger gap.", 20, 650),
  ], 1);
  const merged = mergeDocumentParagraphs(analyzePageLayout(tokens));
  expect(merged.length, 2, "paragraph count");
  expect(merged[0].text, "This is the first visual line and this is its wrapped continuation.", "wrapped text reflow");
});
await test("uses OCR only when text layer is absent", async () => {
  let calls = 0;
  const document = { numPages: 2, async getPage(number: number) { return { getViewport: () => ({ width: 600, height: 800 }), async getTextContent() { return { items: number === 1 ? [item("Digital content", 20, 700)] : [] }; } }; } };
  const result = await extractPdfDocument(document, async () => { calls++; return { width: 600, height: 800, words: [{ text: "Scanned", confidence: 88, bbox: { x0: 20, y0: 700, x1: 90, y1: 720 } }] }; });
  expect(calls, 1, "OCR call count"); expect(result.pages[0].source, "text-layer", "digital page source"); expect(result.pages[1].source, "ocr", "scan page source"); expect(result.pages[1].tokens[0].confidence, 88, "OCR confidence retained");
});
if (failed) process.exit(1);
}
void main();


