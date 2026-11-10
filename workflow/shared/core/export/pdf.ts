/**
 * PDF exporter (pdf-lib) for scanned pages, with an optional invisible text
 * layer. One page-layout rule is used for plain and searchable PDFs, so page
 * size and margins mean the same thing in both.
 */

import {
  PDFDocument, PDFName, TextRenderingMode, beginText, concatTransformationMatrix, drawObject, endText,
  popGraphicsState, pushGraphicsState, setCharacterSqueeze, setFontAndSize, setTextMatrix, setTextRenderingMode, showText,
} from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import { MARGIN_MM, mmToPoints, sheetSize } from "../export-options";
import type { PageMargin, PageSize } from "../export-options";
import { sanitizeDocumentText } from "../upload-security";

/** Encoded page image. `bilevel` is packed 1-bit rows (MSB first, 1 = white). */
export type PdfPageImage =
  | { kind: "jpeg"; bytes: Uint8Array; width: number; height: number }
  | { kind: "png"; bytes: Uint8Array; width: number; height: number }
  | { kind: "bilevel"; bits: Uint8Array; width: number; height: number };

/** A line of text positioned in image pixels (top-left origin). */
export interface PdfTextLine {
  text: string;
  x: number;
  /** Baseline y in image pixels. */
  baseline: number;
  width: number;
  /** Font size in image pixels. */
  size: number;
  /** Counter-clockwise rotation in degrees (for text-layer pages that were rotated). */
  angle?: number;
}

export interface PdfPageInput { image: PdfPageImage; text?: PdfTextLine[] }

export interface PdfExportOptions {
  pageSize: PageSize;
  margin: PageMargin;
  title?: string;
  /** Unicode font (TTF bytes) for the invisible text layer. */
  font?: Uint8Array;
  fontkit?: unknown;
}

export interface PlacedImage { pageWidth: number; pageHeight: number; x: number; y: number; scale: number }

/** Where an image of the given pixel size lands on the sheet (PDF points, bottom-left origin). */
export function placeImage(width: number, height: number, options: Pick<PdfExportOptions, "pageSize" | "margin">): PlacedImage {
  const [pageWidth, pageHeight] = sheetSize(options.pageSize, width, height);
  const margin = mmToPoints(MARGIN_MM[options.margin]);
  const scale = Math.min((pageWidth - margin * 2) / width, (pageHeight - margin * 2) / height);
  return { pageWidth, pageHeight, scale, x: (pageWidth - width * scale) / 2, y: (pageHeight - height * scale) / 2 };
}

async function embedImage(document: PDFDocument, page: PDFPage, image: PdfPageImage, placed: PlacedImage) {
  const width = image.width * placed.scale, height = image.height * placed.scale;
  if (image.kind === "jpeg") { page.drawImage(await document.embedJpg(image.bytes), { x: placed.x, y: placed.y, width, height }); return; }
  if (image.kind === "png") { page.drawImage(await document.embedPng(image.bytes), { x: placed.x, y: placed.y, width, height }); return; }
  // 1-bit DeviceGray image: a fraction of the size of an 8-bit or JPEG page.
  const stream = document.context.flateStream(image.bits, {
    Type: "XObject", Subtype: "Image", Width: image.width, Height: image.height,
    ColorSpace: "DeviceGray", BitsPerComponent: 1,
  });
  const ref = document.context.register(stream);
  const name = page.node.newXObject("Scan", ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(width, 0, 0, height, placed.x, placed.y), drawObject(name), popGraphicsState());
}

function drawInvisibleText(page: PDFPage, font: PDFFont, fontName: PDFName, lines: PdfTextLine[], placed: PlacedImage, imageHeight: number) {
  const operators = [];
  for (const line of lines) {
    const text = sanitizeDocumentText(line.text).replace(/[\r\n\t]+/g, " ").trim();
    if (!text) continue;
    let encoded;
    try { encoded = font.encodeText(text); } catch { continue; }
    const size = Math.max(1, line.size * placed.scale);
    const natural = Math.max(.01, font.widthOfTextAtSize(text, size));
    // Horizontal squeeze makes the selection box match the printed word width.
    const squeeze = Math.max(10, Math.min(400, (line.width * placed.scale) / natural * 100));
    const x = placed.x + line.x * placed.scale;
    const y = placed.y + (imageHeight - line.baseline) * placed.scale;
    const radians = (line.angle ?? 0) * Math.PI / 180;
    operators.push(
      beginText(),
      setFontAndSize(fontName, size),
      setTextRenderingMode(TextRenderingMode.Invisible),
      setCharacterSqueeze(squeeze),
      setTextMatrix(Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), x, y),
      showText(encoded),
      endText(),
    );
  }
  if (operators.length) page.pushOperators(...operators);
}

export async function buildPdfDocument(pages: PdfPageInput[], options: PdfExportOptions): Promise<Uint8Array> {
  if (!pages.length) throw new Error("Không có trang hợp lệ để xuất.");
  const document = await PDFDocument.create();
  document.setTitle(options.title ?? "Tài liệu scan AK Scan");
  document.setCreator("AK Scan");
  document.setProducer("AK Scan (pdf-lib)");
  document.setLanguage("vi-VN");
  document.setCreationDate(new Date());
  const needsFont = pages.some((page) => page.text?.length);
  let font: PDFFont | undefined;
  if (needsFont) {
    if (!options.font || !options.fontkit) throw new Error("Thiếu font Unicode cho lớp chữ PDF.");
    document.registerFontkit(options.fontkit as Parameters<PDFDocument["registerFontkit"]>[0]);
    font = await document.embedFont(options.font, { subset: true });
  }
  for (const input of pages) {
    const placed = placeImage(input.image.width, input.image.height, options);
    const page = document.addPage([placed.pageWidth, placed.pageHeight]);
    await embedImage(document, page, input.image, placed);
    if (font && input.text?.length) {
      const fontName = page.node.newFontDictionary(font.name, font.ref);
      drawInvisibleText(page, font, fontName, input.text, placed, input.image.height);
    }
  }
  return document.save({ useObjectStreams: true });
}

export { packBilevel } from "../bilevel";
