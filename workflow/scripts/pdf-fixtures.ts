/**
 * Synthetic PDFs for tests (no customer documents are committed). The packing
 * slip mimics an Excel export: borders as thin filled rectangles, coloured
 * header cells, a vertically merged cell, a merged "Lot" row, multi-line cells,
 * a borderless key/value block and a centred signature row.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";

const root = join(__dirname, "..", "..");

export async function packingSlipPdf() {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const regular = await document.embedFont(readFileSync(join(root, "public", "NotoSans-Regular.ttf")), { subset: true });
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([612, 792]);
  const top = (y: number) => 792 - y; // layout y (top-down) → PDF y
  const text = (value: string, x: number, y: number, size = 9, font: PDFFont = regular, color = rgb(0, 0, 0)) => page.drawText(value, { x, y: top(y), size, font, color });
  const centered = (value: string, x0: number, x1: number, y: number, size = 9, font: PDFFont = regular, color = rgb(0, 0, 0)) => text(value, (x0 + x1) / 2 - font.widthOfTextAtSize(value, size) / 2, y, size, font, color);
  const hLine = (target: PDFPage, x0: number, x1: number, y: number) => target.drawRectangle({ x: x0, y: top(y) - .3, width: x1 - x0, height: .6, color: rgb(.6, .6, .6) });
  const vLine = (target: PDFPage, x: number, y0: number, y1: number) => target.drawRectangle({ x: x - .3, y: top(y1), width: .6, height: y1 - y0, color: rgb(.6, .6, .6) });
  const fill = (x0: number, y0: number, x1: number, y1: number, color: ReturnType<typeof rgb>) => page.drawRectangle({ x: x0, y: top(y1), width: x1 - x0, height: y1 - y0, color });

  text("CÔNG TY TNHH MẪU THỬ", 160, 60, 10, regular);
  text("Mã số thuế: 0123 456 789", 160, 74, 7);
  text("Địa chỉ: 12 Đường Số 1, Phường Bến Nghé, TP Hồ Chí Minh, Việt Nam", 160, 84, 7);
  text("Tel: 090 000 0000", 160, 94, 7);
  fill(50, 104, 520, 120, rgb(.64, .12, .12));
  centered("PHIEU XUAT KHO", 50, 520, 116, 12, bold, rgb(1, 1, 1));

  // Table 1: header row (red) + one data row with a two-line code cell.
  const xs = [50, 110, 160, 360, 410, 460, 520];
  const ys1 = [130, 155, 185];
  fill(50, 130, 520, 155, rgb(.82, .17, .17));
  ys1.forEach((y) => hLine(page, 50, 520, y));
  xs.forEach((x) => vLine(page, x, 130, 185));
  ["STT", "MA", "TEN MAT HANG", "DVT", "SO KIEN", "SO LUONG"].forEach((label, index) => centered(label, xs[index], xs[index + 1], 146, 8, bold, rgb(1, 1, 1)));
  centered("1", 50, 110, 172, 9, bold);
  centered("SS6960-", 110, 160, 166, 8, bold);
  centered("Phantom", 110, 160, 177, 8, bold);
  text("Vải vân điểm 65*60, khổ 58-59''", 165, 172, 8);
  centered("Yard", 360, 410, 172);
  centered("20", 410, 460, 172, 9, bold);
  centered("3.031,0", 460, 520, 172, 9, bold);

  // Table 2: column 0 merged over the data rows, "Lot 1 | Lot 2" merged labels.
  const xs2 = [50, 110, 150, 200, 240, 290];
  fill(50, 200, 290, 215, rgb(.82, .17, .17));
  centered("CHI TIET THEO CUON", 50, 290, 211, 8, bold, rgb(1, 1, 1));
  hLine(page, 50, 290, 200); hLine(page, 50, 290, 215); hLine(page, 50, 290, 260);
  hLine(page, 110, 290, 230); hLine(page, 110, 290, 245);
  vLine(page, 50, 200, 260); vLine(page, 290, 200, 260); vLine(page, 110, 215, 260);
  [150, 200, 240].forEach((x) => vLine(page, x, 230, 260));
  centered("SS6960-Phantom", 50, 110, 240, 7, bold);
  centered("Lot 1", 110, 200, 226, 8, bold);
  centered("Lot 2", 200, 290, 226, 8, bold);
  [["16", "164", "2", "82"], ["17", "144", "3", "115"]].forEach((row, r) => row.forEach((value, c) => centered(value, xs2[c + 1], xs2[c + 2], 241 + r * 15, 8)));

  // Borderless key/value block and centred signature row.
  [["Khách hàng:", "CÔNG TY CỔ PHẦN MẪU"], ["Người nhận:", "Chị A - 0900000000"], ["Vận chuyển:", "Công ty TNHH Vận Tải"]].forEach(([label, value], index) => {
    text(label, 55, 290 + index * 12, 8);
    text(value, 160, 290 + index * 12, 8);
  });
  [["NGƯỜI GIAO", 60, 180], ["NGƯỜI NHẬN", 380, 500]].forEach(([label, x0, x1]) => {
    centered(label as string, x0 as number, x1 as number, 350, 8);
    centered("(Ký, ghi rõ họ tên)", x0 as number, x1 as number, 362, 7);
  });

  // A wrapped prose paragraph.
  text("Hàng hóa đã được kiểm tra đầy đủ về số lượng và chất lượng trước khi giao cho", 55, 400, 9);
  text("bên vận chuyển theo đúng đơn đặt hàng.", 55, 412, 9);
  return document.save();
}

/** A page that is one big picture with a hidden text layer (a scanner's PDF). */
export async function scannedWithOcrLayerPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const png = await document.embedPng(readFileSync(join(root, "public", "icon-192.png")));
  page.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Scanned page with an invisible OCR layer from the scanner", { x: 40, y: 700, size: 12, font, opacity: 0 });
  return document.save();
}
