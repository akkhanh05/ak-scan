/**
 * End-to-end export tests through the application's own pipeline and
 * exporters (only the browser render worker and Tesseract are faked), then the
 * produced DOCX/PDF files are opened and their content inspected.
 */
import JSZip from "jszip";
import { Packer } from "docx";
import { defaultExportOptions } from "../shared/core/export-options";
import type { ExportOptions } from "../shared/core/export-options";
import { applyOcrCorrections, buildPageContents, buildPdfPages, exportFileName, recognizePage, recognizePages, textLayerLines } from "../shared/core/export-pipeline";
import type { OcrResultLike, PipelineDeps } from "../shared/core/export-pipeline";
import { createWordDocument } from "../shared/core/export/word";
import { buildPdfDocument, placeImage } from "../shared/core/export/pdf";
import { defaultCorners, defaultSettings } from "../shared/core/scan";
import type { ScanPage } from "../shared/core/scan";
import { outputName } from "../ui/export-runner";
import { packingSlipPdf } from "./pdf-fixtures";
import { readPdfPage } from "./pdf-node";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) { try { await fn(); console.log(`  [PASS] ${name}`); } catch (error) { failed++; console.error(`  [FAIL] ${name}: ${(error as Error).message}`); } }
function expect(actual: unknown, expected: unknown, message: string) { if (actual !== expected) throw new Error(`${message}; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
function count(haystack: string, needle: string | RegExp) { return typeof needle === "string" ? haystack.split(needle).length - 1 : (haystack.match(needle) ?? []).length; }

// 1×1 white JPEG.
const JPEG = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"));
const font = new Uint8Array(readFileSync(join(__dirname, "..", "..", "public", "NotoSans-Regular.ttf")));

function scanPage(id: string, extra: Partial<ScanPage> = {}): ScanPage {
  return { id, name: `${id}.jpg`, url: `blob:${id}`, rotation: 0, fineRotation: 0, dewarp: true, corners: defaultCorners.map((point) => ({ ...point })) as ScanPage["corners"], settings: { ...defaultSettings }, ...extra };
}

type FakeLine = { text: string; y: number; confidence?: number; paragraph?: number };
function tesseract(lines: FakeLine[], confidence = 97): OcrResultLike {
  const paragraphs = new Map<number, FakeLine[]>();
  lines.forEach((line, index) => paragraphs.set(line.paragraph ?? index, [...(paragraphs.get(line.paragraph ?? index) ?? []), line]));
  return {
    data: {
      text: lines.map((line) => line.text).join("\n"),
      confidence,
      blocks: [{ paragraphs: [...paragraphs.values()].map((group) => ({ lines: group.map((line) => {
        let x = 100;
        const words = line.text.split(" ").map((text) => { const box = { x0: x, y0: line.y, x1: x + text.length * 18, y1: line.y + 30 }; x = box.x1 + 12; return { text, confidence: line.confidence ?? 96, bbox: box }; });
        return { text: line.text, confidence: line.confidence ?? 96, bbox: { x0: 100, y0: line.y, x1: Math.max(...words.map((w) => w.bbox.x1)), y1: line.y + 30 }, words };
      }) })) }],
    },
  };
}

function fakeDeps(result: OcrResultLike, renderSize = { width: 2000, height: 2800 }): PipelineDeps {
  return {
    render: async (_page, _edge, output) => output.kind === "bilevel"
      ? { width: 16, height: 8, bits: new Uint8Array(16).fill(0xff).buffer }
      : output.kind === "jpeg" ? { width: 1, height: 1, bytes: JPEG.slice().buffer } : { ...renderSize, bytes: new Uint8Array([137, 80, 78, 71]).buffer, mime: "image/png", grid: null },
    // A rectangle (single-line re-read) returns only that line, like Tesseract.
    recognize: async (request) => {
      if (!request.rectangle) return result;
      const line = result.data.blocks!.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines)).find((candidate) => Math.abs(candidate.bbox.y0 - (request.rectangle!.top + 18)) < 20);
      return { data: { text: line?.text ?? "", confidence: line?.confidence ?? 0, blocks: null } };
    },
    checkCancelled: () => undefined,
  };
}

async function docxXml(pages: Awaited<ReturnType<typeof buildPageContents>>, options: Partial<ExportOptions> = {}) {
  const merged = { ...defaultExportOptions, format: "docx" as const, ...options };
  const buffer = await Packer.toBuffer(createWordDocument(pages, { pageSize: merged.pageSize, margin: merged.margin, mode: merged.wordMode }));
  const zip = await JSZip.loadAsync(buffer);
  return { document: await zip.file("word/document.xml")!.async("text"), styles: await zip.file("word/styles.xml")!.async("text"), numbering: await zip.file("word/numbering.xml")?.async("text") ?? "" };
}

async function main() {
  console.log("EXPORT PIPELINE TESTS");
  const slipBytes = await packingSlipPdf();
  const slip = await readPdfPage(slipBytes);
  const documentPage = scanPage("doc", { pdfKind: "document", pdfPage: { width: slip.width, height: slip.height, items: slip.items, graphics: slip.graphics }, sourceWidth: 1700, sourceHeight: 2200 });

  await test("text-layer PDF → Word: real tables, merged cells, shading, Vietnamese language, A4 + margins", async () => {
    const { document, styles } = await docxXml(await buildPageContents([documentPage], new Map(), fakeDeps(tesseract([]))));
    if (count(document, "<w:tbl>") < 2) throw new Error("expected at least two tables");
    expect(document.includes("<w:gridSpan w:val=\"2\"/>"), true, "horizontal merge");
    expect(document.includes("<w:vMerge w:val=\"restart\"/>"), true, "vertical merge");
    expect(document.includes("w:fill=\"d12b2b\""), true, "cell shading");
    expect(document.includes("SS6960-Phantom"), true, "code joined");
    expect(document.includes("w:val=\"vi-VN\"") || styles.includes("w:val=\"vi-VN\""), true, "Vietnamese proofing language");
    expect(document.includes("en-US"), false, "no English proofing language");
    expect(document.includes("<w:pgSz w:w=\"11906\" w:h=\"16838\""), true, "A4 portrait page");
    expect(document.includes("w:left=\"454\""), true, "8 mm margin");
  });

  await test("Letter and large margin are honoured in Word", async () => {
    const { document } = await docxXml(await buildPageContents([documentPage], new Map(), fakeDeps(tesseract([]))), { pageSize: "letter", margin: "large" });
    expect(document.includes("<w:pgSz w:w=\"12240\" w:h=\"15840\""), true, "Letter page");
    expect(document.includes("w:left=\"850\""), true, "15 mm margin");
  });

  await test("cropping a text-layer page removes the cropped text from Word", async () => {
    const cropped = { ...documentPage, corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .24 }, { x: 0, y: .24 }] as ScanPage["corners"] };
    const { document } = await docxXml(await buildPageContents([cropped], new Map(), fakeDeps(tesseract([]))));
    expect(document.includes("Khách hàng"), false, "text below the crop is gone");
    expect(document.includes("MẪU THỬ"), true, "text inside the crop stays");
  });

  const ocrResult = tesseract([
    { text: "BIÊN BẢN GIAO NHẬN", y: 100 },
    { text: "1. Bên giao kiểm hàng", y: 200, paragraph: 1 },
    { text: "2. Bên nhận ký xác nhận", y: 240, paragraph: 2 },
    { text: "Tổng cộng: 100.000", y: 320, paragraph: 3 },
    { text: "Tổng cộng: 100.000", y: 380, paragraph: 4 },
    { text: "Ghi chú 1.25O.000", y: 440, confidence: 60, paragraph: 5 },
  ]);
  const photo = scanPage("photo");
  const ocr = await recognizePage(photo, defaultExportOptions, fakeDeps(ocrResult));

  await test("OCR keeps both legitimate total lines", () => expect(ocr.lines.filter((line) => line.text === "Tổng cộng: 100.000").length, 2, "two totals"));
  await test("OCR marks the low-confidence line for review", () => expect((ocr.lines.find((line) => line.text.startsWith("Ghi chú"))?.flaggedWords ?? 0) > 0, true, "flagged"));
  await test("a re-read that picks up neighbouring lines cannot replace a line", async () => {
    const greedy: PipelineDeps = { ...fakeDeps(ocrResult), recognize: async (request) => request.rectangle ? { data: { text: "Ghi chú 1.25O.000 Tổng cộng: 100.000 Tổng cộng: 100.000 BIÊN BẢN GIAO NHẬN", confidence: 99, blocks: null } } : ocrResult };
    const result = await recognizePage(photo, defaultExportOptions, greedy);
    expect(result.lines.find((line) => line.text.startsWith("Ghi chú"))?.text, "Ghi chú 1.25O.000", "line kept");
  });

  await test("review corrections reach the Word file; lists become real numbering", async () => {
    const index = ocr.lines.findIndex((line) => line.text.startsWith("Ghi chú"));
    const corrected = applyOcrCorrections(ocr, ocr.lines.map((line, i) => i === index ? "Ghi chú 1.250.000" : line.text));
    const { document, numbering } = await docxXml(await buildPageContents([photo], new Map([[photo.id, corrected]]), fakeDeps(ocrResult)));
    expect(document.includes("1.250.000"), true, "corrected amount");
    expect(document.includes("1.25O.000"), false, "uncorrected text gone");
    expect(count(document, "Tổng cộng: 100.000"), 2, "both totals in Word");
    expect(count(document, "<w:numPr>"), 2, "two numbered list paragraphs");
    expect(numbering.includes("w:val=\"decimal\""), true, "decimal numbering defined");
    expect(document.includes(">1. Bên"), false, "typed list marker removed");
  });

  await test("searchable PDF: invisible OCR text lands on its line, inside the page margins", async () => {
    const options = { ...defaultExportOptions, searchable: true };
    const inputs = await buildPdfPages([photo], new Map([[photo.id, ocr]]), options, { ...fakeDeps(ocrResult), render: async () => ({ width: 1000, height: 1400, bytes: JPEG.slice().buffer }) });
    const bytes = await buildPdfDocument(inputs, { pageSize: "a4", margin: "small", font, fontkit });
    const page = await readPdfPage(bytes);
    expect(Math.round(page.width), 595, "A4 width");
    const placed = placeImage(1000, 1400, { pageSize: "a4", margin: "small" });
    const ratio = 1000 / 2000;
    const totals = page.items.filter((item) => item.text === "Tổng cộng: 100.000");
    expect(totals.length, 2, "both totals searchable");
    const expectedX = placed.x + 100 * ratio * placed.scale;
    if (Math.abs(totals[0].x - expectedX) > 1) throw new Error(`text x ${totals[0].x} vs ${expectedX}`);
    const expectedBaseline = placed.y + (1400 - (320 + 30) * ratio + 30 * ratio * .22) * placed.scale;
    if (Math.abs(totals[0].y - expectedBaseline) > 1.5) throw new Error(`baseline ${totals[0].y} vs ${expectedBaseline}`);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
    const operators = await (await (await task.promise).getPage(1)).getOperatorList();
    const modes = operators.fnArray.flatMap((fn, index) => fn === pdfjs.OPS.setTextRenderingMode ? [operators.argsArray[index][0]] : []);
    await task.destroy();
    expect(modes.length > 0 && modes.every((mode: number) => mode === 3), true, "text rendering mode 3 (invisible)");
  });

  await test("searchable PDF from a text-layer page uses the PDF's own text, rotated with the page", async () => {
    const rotated = { ...documentPage, rotation: 90 };
    const lines = textLayerLines(rotated, { width: 1100, height: 850 });
    const header = lines.find((line) => line.text === "SO LUONG");
    expect(Boolean(header), true, "header text mapped");
    if (Math.abs((header!.angle ?? 0) + 90) > .5) throw new Error(`angle ${header!.angle}`);
    const inputs = await buildPdfPages([rotated], null, { ...defaultExportOptions, searchable: true }, { ...fakeDeps(ocrResult), render: async () => ({ width: 1100, height: 850, bytes: JPEG.slice().buffer }) });
    const pdf = await readPdfPage(await buildPdfDocument(inputs, { pageSize: "a4", margin: "small", font, fontkit }));
    expect(pdf.width > pdf.height, true, "landscape content gets a landscape A4 sheet");
    expect(pdf.items.some((item) => item.text === "Khách hàng:"), true, "text layer present");
  });

  await test("black-and-white pages are stored as 1-bit images", async () => {
    const page = scanPage("bw", { settings: { ...defaultSettings, filter: "bw" } });
    const inputs = await buildPdfPages([page], null, defaultExportOptions, fakeDeps(ocrResult));
    const text = new TextDecoder("latin1").decode(await buildPdfDocument(inputs, { pageSize: "fit", margin: "none" }));
    expect(/\/BitsPerComponent 1\b/.test(text), true, "1-bit image");
  });

  await test("an OCR failure names the page it happened on", async () => {
    const failing: PipelineDeps = { ...fakeDeps(ocrResult), recognize: async () => { throw new Error("Nhận diện văn bản trang này mất quá nhiều thời gian."); } };
    try {
      await recognizePages([scanPage("p1", { name: "hoa-don.jpg" })], defaultExportOptions, failing);
      throw new Error("expected a failure");
    } catch (error) {
      expect((error as Error).message.startsWith("Trang 1 (hoa-don.jpg):"), true, (error as Error).message);
    }
  });

  await test("output names follow the source file and are safe", () => {
    expect(outputName([scanPage("a", { name: "PKL SS6960 LẦN 7 (3).pdf · trang 1" })], "docx"), "PKL SS6960 LẦN 7 (3).docx", "docx name");
    expect(outputName([scanPage("a", { name: "a:b/c*?.jpg" })], "pdf"), "a b c.pdf", "unsafe characters");
    expect(exportFileName("ak-scan", "pdf", new Date(2026, 10, 10, 23, 30)), "ak-scan-2026-11-10.pdf", "local date, not UTC");
  });

  if (failed) { console.error(`\n${failed} export test(s) failed`); process.exit(1); }
  console.log("\nPASS: export tests");
}

void main();
