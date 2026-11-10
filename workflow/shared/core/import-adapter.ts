"use client";
/**
 * Browser adapter for importing photos and PDFs. Every step that the file can
 * slow down has a deadline, and sizes are checked before memory is committed.
 */
import { classifyPdfPage } from "@/workflow/scan-from-pdf-images/core";
import { describePdfFont, extractPdfGraphics } from "./pdf-document";
import type { PdfGraphics, PdfTextItem } from "./pdf-document";
import { detectUploadKind, readImageDimensions, safeDisplayName, sanitizeDocumentText, withTimeout } from "./upload-security";

export const MAX_PAGES = 20;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_BYTES = 40 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 24_000_000;
const PDF_STEP_TIMEOUT = 30_000;
/** Long edge of a rendered PDF page in pixels (≈ 190 dpi for A4). */
const PDF_RENDER_EDGE = 2200;

/** Decoded-pixel budget for one session, lower on devices that report little RAM. */
export function sessionPixelBudget() {
  const memory = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  if (memory !== undefined && memory <= 2) return 40_000_000;
  if (memory !== undefined && memory <= 4) return 80_000_000;
  return 160_000_000;
}

export interface ImportedPage {
  url: string;
  name: string;
  width: number;
  height: number;
  pdfKind?: "document" | "scan";
  pdfPage?: { width: number; height: number; items: PdfTextItem[]; graphics: PdfGraphics };
}

export class ImportError extends Error {}

async function encodePng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new ImportError("Không thể tạo ảnh trang PDF.")), "image/png"));
}

export async function importImage(file: File, register: (url: string) => void): Promise<ImportedPage> {
  const name = safeDisplayName(file.name);
  const kind = await detectUploadKind(file);
  if (!kind || kind === "pdf") throw new ImportError(`${name}: nội dung file không phải ảnh JPG, PNG hoặc WebP hợp lệ.`);
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new ImportError(`${name}: ảnh phải nhỏ hơn 15 MB.`);
  const header = await readImageDimensions(file, kind);
  if (!header) throw new ImportError(`${name}: không đọc được kích thước ảnh, file có thể bị hỏng.`);
  if (header.width * header.height > MAX_IMAGE_PIXELS) throw new ImportError(`${name}: ảnh ${header.width}×${header.height} vượt giới hạn 24 megapixel.`);
  const url = URL.createObjectURL(file);
  try {
    const size = await withTimeout(decodedSize(url), 15_000, `${name}: đọc ảnh quá thời gian cho phép.`);
    register(url);
    return { url, name, ...size };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error instanceof ImportError ? error : new ImportError(error instanceof Error ? error.message : `${name}: file ảnh bị hỏng.`);
  }
}

/** Decodes once to validate the file; returns the EXIF-oriented size. */
async function decodedSize(url: string) {
  if (typeof createImageBitmap === "function") {
    const blob = await (await fetch(url)).blob();
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
    catch { bitmap = await createImageBitmap(blob).catch(() => { throw new ImportError("File ảnh bị hỏng."); }); }
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new ImportError("File ảnh bị hỏng."));
    image.src = url;
  });
}

export interface OpenedPdf {
  name: string;
  numPages: number;
  /** Pixel size the page will occupy once rendered (checked against the session budget first). */
  renderedPixels(pageNumber: number): Promise<number>;
  renderPage(pageNumber: number, register: (url: string) => void): Promise<ImportedPage>;
  close(): Promise<void>;
}

export async function openPdf(file: File): Promise<OpenedPdf> {
  const name = safeDisplayName(file.name);
  if (await detectUploadKind(file) !== "pdf") throw new ImportError(`${name}: nội dung file không phải PDF hợp lệ.`);
  if (!file.size || file.size > MAX_PDF_BYTES) throw new ImportError(`${name}: PDF phải nhỏ hơn 40 MB.`);
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableXfa: false, disableAutoFetch: true });
  let pdf: Awaited<typeof task.promise>;
  try {
    pdf = await withTimeout(task.promise, PDF_STEP_TIMEOUT, `${name}: PDF mất quá nhiều thời gian để mở.`);
  } catch (error) {
    await task.destroy();
    if (error instanceof Error && error.name === "PasswordException") throw new ImportError(`${name}: PDF được bảo vệ bằng mật khẩu. Hãy mở khóa PDF rồi thử lại.`);
    if (error instanceof Error && error.name === "InvalidPDFException") throw new ImportError(`${name}: PDF bị hỏng hoặc không đúng cấu trúc.`);
    throw error instanceof Error ? new ImportError(error.message) : error;
  }

  const getPage = (pageNumber: number) => withTimeout(pdf.getPage(pageNumber), PDF_STEP_TIMEOUT, `${name}: không đọc được trang ${pageNumber}.`);
  const scaleOf = (page: Awaited<ReturnType<typeof getPage>>) => {
    const base = page.getViewport({ scale: 1 });
    return Math.min(2.4, PDF_RENDER_EDGE / Math.max(base.width, base.height));
  };

  return {
    name,
    numPages: pdf.numPages,
    async renderedPixels(pageNumber) {
      const page = await getPage(pageNumber);
      const viewport = page.getViewport({ scale: scaleOf(page) });
      return Math.round(viewport.width) * Math.round(viewport.height);
    },
    async renderPage(pageNumber, register) {
      const page = await getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: scaleOf(page) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      try {
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new ImportError(`${name}: không thể dựng trang ${pageNumber}.`);
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await withTimeout(page.render({ canvas, canvasContext: context, viewport }).promise, PDF_STEP_TIMEOUT, `${name}: trang ${pageNumber} mất quá nhiều thời gian để dựng.`);
        const [textContent, operatorList] = await withTimeout(Promise.all([page.getTextContent(), page.getOperatorList()]), PDF_STEP_TIMEOUT, `${name}: không đọc được nội dung trang ${pageNumber}.`);
        const fontName = (id: string) => { try { return (page.commonObjs.get(id) as { name?: string } | undefined)?.name ?? ""; } catch { return ""; } };
        const items: PdfTextItem[] = textContent.items.flatMap((item) => {
          if (!("str" in item) || !item.str.trim()) return [];
          const font = describePdfFont(fontName(item.fontName));
          return [{ text: sanitizeDocumentText(item.str), x: item.transform[4], y: item.transform[5], width: item.width, height: item.height, fontName: item.fontName, hasEol: item.hasEOL, bold: font.bold, italic: font.italic, fontFamily: font.family }];
        });
        const graphics = extractPdfGraphics(operatorList.fnArray, operatorList.argsArray, pdfjs.OPS as unknown as Record<string, number>);
        const pdfPage = { width: base.width, height: base.height, items, graphics };
        // Lossless page image: avoids a second JPEG generation on export.
        const url = URL.createObjectURL(await encodePng(canvas));
        register(url);
        return { url, name: `${name} · trang ${pageNumber}`, width: canvas.width, height: canvas.height, pdfKind: classifyPdfPage(items, pdfPage, graphics), pdfPage };
      } finally {
        canvas.width = 0; canvas.height = 0;
        page.cleanup();
      }
    },
    async close() {
      await pdf.cleanup().catch(() => undefined);
      await task.destroy().catch(() => undefined);
    },
  };
}
