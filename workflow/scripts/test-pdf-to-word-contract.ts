/** In-memory DOCX contract tests for an editable PDF-to-Word conversion. */
import JSZip from "jszip";
import { Document, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { groupPdfTextItems, postProcessOcrLine } from "../shared/core/ocr";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  [PASS] ${message}`);
  else { failures++; console.error(`  [FAIL] ${message}`); }
}
function word(text: string, confidence: number, x: number, y = 100) {
  return { text, confidence, bbox: { x0: x, y0: y, x1: x + Math.max(8, text.length * 10), y1: y + 20 } };
}
async function xml(zip: JSZip, name: string) {
  const entry = zip.file(name);
  if (!entry) throw new Error(`Missing OOXML part: ${name}`);
  return entry.async("text");
}

async function main() {
console.log("PDF TO WORD EDITABILITY CONTRACT SUITE\n");
const textLayer = groupPdfTextItems([
  { text: "BÁO CÁO & KẾ HOẠCH", x: 20, y: 720, width: 180, height: 20, fontName: "Bold", hasEol: true },
  { text: "Hello", x: 20, y: 680, width: 35, height: 11, fontName: "Body", hasEol: false },
  { text: "Việt Nam <2026>", x: 60, y: 680, width: 105, height: 11, fontName: "Body", hasEol: true },
]);
check(textLayer.length === 2, "PDF text layer is grouped into editable lines");
check(textLayer[0]?.heading === true, "larger text-layer line is classified as a heading");
check(textLayer[1]?.text === "Hello Việt Nam <2026>", "English, Vietnamese, and special characters survive text-layer reconstruction");
const scannedLine = postProcessOcrLine({ words: [word("Mục", 96, 0), word("g", 20, 38), word("tiêu", 96, 49), word("2026", 96, 90)] });
check(scannedLine.text === "Mục tiêu 2026", "scan/OCR contract removes an inserted noise glyph before Word export");

const tinyPng = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+qR5+swAAAABJRU5ErkJggg==", "base64"));
const document = new Document({ sections: [{ children: [
  new Paragraph({ heading: "Heading2", children: [new TextRun(textLayer[0].text)] }),
  new Paragraph({ children: [new TextRun(textLayer[1].text)] }),
  new Paragraph({ bullet: { level: 0 }, children: [new TextRun("Danh sách có thể chỉnh sửa")] }),
  new Paragraph({ children: [new TextRun(scannedLine.text)] }),
  new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("Cột A")] }), new TableCell({ children: [new Paragraph("Column B")] })] })] }),
  new Paragraph({ children: [new ImageRun({ data: tinyPng, transformation: { width: 1, height: 1 }, type: "png" })] }),
  new Paragraph({ pageBreakBefore: true, children: [new TextRun("Trang 2 / Page 2")] }),
] }] });
const zip = await JSZip.loadAsync(await Packer.toBuffer(document));
const documentXml = await xml(zip, "word/document.xml");
const stylesXml = await xml(zip, "word/styles.xml");
const contentTypesXml = await xml(zip, "[Content_Types].xml");
check(zip.file("word/document.xml") !== null && zip.file("word/styles.xml") !== null, "DOCX contains editable document and style parts");
check(documentXml.includes("<w:pStyle w:val=\"Heading2\""), "heading is emitted as a Word heading style, not flattened text");
check(documentXml.includes("<w:numPr>"), "list is emitted as Word numbering, not a typed bullet character");
check(documentXml.includes("<w:tbl>"), "table is emitted as editable OOXML table cells");
check(documentXml.includes("<w:pageBreakBefore/>"), "page boundary is emitted as a Word page break");
check(documentXml.includes("BÁO CÁO") && documentXml.includes("Việt Nam") && documentXml.includes("&lt;2026&gt;"), "Unicode and XML-special text are preserved safely");
check(documentXml.includes("Mục tiêu 2026") && !documentXml.includes(">g<"), "OCR-cleaned scan text is editable text, without the removed artifact");
check(zip.file(/word\/media\//).length === 1 && documentXml.includes("<w:drawing>"), "image is packaged as a DOCX media object");
check(stylesXml.includes("w:styleId=\"Heading2\"") && contentTypesXml.includes("wordprocessingml.document"), "DOCX advertises standard Word styles and document content type");
console.log(`\n${failures ? "FAIL" : "PASS"}: ${failures ? failures : 13} PDF-to-Word contract checks`);
if (failures) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});


