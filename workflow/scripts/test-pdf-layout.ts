/** Text-layer PDF → document model: ruled tables, merged cells, forms, crop. */
import { existsSync, readFileSync } from "node:fs";
import { classifyPdfPage } from "../scan-from-pdf-images/core";
import { describePdfFont, layoutTextLayerPage } from "../shared/core/pdf-document";
import { plainText } from "../shared/core/document-model";
import type { ParagraphBlock, TableBlock } from "../shared/core/document-model";
import { packingSlipPdf, scannedWithOcrLayerPdf } from "./pdf-fixtures";
import { readPdfPage } from "./pdf-node";

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) { try { await fn(); console.log(`  [PASS] ${name}`); } catch (error) { failed++; console.error(`  [FAIL] ${name}: ${(error as Error).message}`); } }
function expect(actual: unknown, expected: unknown, message: string) { if (actual !== expected) throw new Error(`${message}; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
const cells = (table: TableBlock) => table.rows.map((row) => row.map((cell) => plainText(cell.runs)));

async function main() {
  console.log("PDF TEXT-LAYER LAYOUT TESTS");
  const slip = await readPdfPage(await packingSlipPdf());
  const content = layoutTextLayerPage(slip.items, slip.graphics, slip);
  const tables = content.blocks.filter((block) => block.kind === "table") as TableBlock[];
  const ruled = tables.filter((table) => table.bordered);
  const paragraphs = content.blocks.filter((block) => block.kind !== "table" && block.kind !== "image") as ParagraphBlock[];

  await test("font names give family and style", () => {
    expect(JSON.stringify(describePdfFont("BCDEEE+Calibri-Bold")), JSON.stringify({ family: "Calibri", bold: true, italic: false }), "Calibri bold");
    expect(describePdfFont("TimesNewRomanPS-ItalicMT").family, "Times New Roman", "Times family");
    expect(describePdfFont("TimesNewRomanPS-ItalicMT").italic, true, "italic");
  });
  await test("ruled tables are rebuilt from the drawn borders", () => expect(ruled.length, 2, "two ruled tables"));
  await test("table 1 keeps header, columns and a two-line product code", () => {
    const rows = cells(ruled[0]);
    expect(rows[0].join("|"), "STT|MA|TEN MAT HANG|DVT|SO KIEN|SO LUONG", "header");
    expect(rows[1].join("|"), "1|SS6960-Phantom|Vải vân điểm 65*60, khổ 58-59''|Yard|20|3.031,0", "data row, hyphenated code joined");
    expect(ruled[0].rows[0][0].shading, "d12b2b", "header shading kept");
    expect(ruled[0].rows[0][0].runs[0].color, "ffffff", "light text on dark header");
    expect(ruled[0].rows[1][0].align, "center", "centred cell");
  });
  await test("table 2 keeps the vertically merged cell and splits the merged Lot labels", () => {
    const table = ruled[1];
    const merged = table.rows.flat().find((cell) => plainText(cell.runs) === "SS6960-Phantom");
    expect(merged?.rowSpan, 3, "code spans the three data rows");
    const lot1 = table.rows.flat().find((cell) => plainText(cell.runs) === "Lot 1");
    const lot2 = table.rows.flat().find((cell) => plainText(cell.runs) === "Lot 2");
    expect(lot1?.colSpan, 2, "Lot 1 spans two columns");
    expect(lot2?.colSpan, 2, "Lot 2 spans two columns");
    expect(cells(table).at(-1)?.join("|"), "17|144|3|115", "last row values in their columns");
  });
  await test("aligned label/value lines become a borderless table", () => {
    const form = tables.find((table) => !table.bordered && cells(table)[0][0] === "Khách hàng:");
    expect(Boolean(form), true, "form table");
    expect(cells(form!).map((row) => row.join("=")).join(" | "), "Khách hàng:=CÔNG TY CỔ PHẦN MẪU | Người nhận:=Chị A - 0900000000 | Vận chuyển:=Công ty TNHH Vận Tải", "values");
  });
  await test("signature row keeps its columns and centring", () => {
    const signatures = tables.find((table) => !table.bordered && cells(table)[0][0] === "NGƯỜI GIAO");
    expect(Boolean(signatures), true, "signature table");
    expect(cells(signatures!)[1].join("|"), "(Ký, ghi rõ họ tên)|(Ký, ghi rõ họ tên)", "second row");
    expect(signatures!.rows[1][0].align, "center", "centred column");
  });
  await test("separate header fields are not merged into one paragraph", () => {
    const texts = paragraphs.map((block) => plainText(block.runs));
    expect(texts.includes("Mã số thuế: 0123 456 789"), true, "tax id line");
    expect(texts.includes("Tel: 090 000 0000"), true, "phone line");
  });
  await test("wrapped prose lines become one paragraph", () => {
    expect(paragraphs.some((block) => plainText(block.runs) === "Hàng hóa đã được kiểm tra đầy đủ về số lượng và chất lượng trước khi giao cho bên vận chuyển theo đúng đơn đặt hàng."), true, "prose");
  });
  await test("a banner keeps its band colour and white text", () => {
    const banner = paragraphs.find((block) => plainText(block.runs) === "PHIEU XUAT KHO");
    expect(banner?.shading, "a31f1f", "banner fill");
    expect(banner?.align, "center", "centred in band");
    expect(Boolean(banner?.shadingBox), true, "band extent kept");
  });
  await test("cropping the page removes content outside the crop", () => {
    const cropped = layoutTextLayerPage(slip.items, slip.graphics, slip, { crop: [{ x: 0, y: 0 }, { x: 612, y: 0 }, { x: 612, y: 190 }, { x: 0, y: 190 }] });
    const text = JSON.stringify(cropped.blocks);
    expect(text.includes("Khách hàng"), false, "content below the crop is excluded");
    expect(text.includes("SO LUONG"), true, "content inside the crop is kept");
  });
  await test("a text-layer page is classified as a document", () => expect(classifyPdfPage(slip.items, slip, slip.graphics), "document", "document"));
  await test("a full-page picture with a hidden OCR layer is classified as a scan", async () => {
    const scan = await readPdfPage(await scannedWithOcrLayerPdf());
    expect(scan.items.length > 0, true, "hidden text exists");
    expect(classifyPdfPage(scan.items, scan, scan.graphics), "scan", "scan");
  });

  // Optional: a real document supplied locally (never committed).
  const local = process.env.AK_SCAN_SAMPLE_PDF;
  if (local && existsSync(local)) {
    await test(`local sample ${local.split("/").at(-1)} produces ruled tables`, async () => {
      const real = await readPdfPage(new Uint8Array(readFileSync(local)));
      const realContent = layoutTextLayerPage(real.items, real.graphics, real);
      const count = realContent.blocks.filter((block) => block.kind === "table" && block.bordered).length;
      if (count < 1) throw new Error("no ruled table found");
      console.log(`      ${count} ruled tables, ${realContent.blocks.length} blocks`);
    });
  }

  if (failed) { console.error(`\n${failed} layout test(s) failed`); process.exit(1); }
  console.log("\nPASS: PDF layout tests");
}

void main();
