/** Reads a PDF page in Node exactly like the browser import adapter does. */
import { describePdfFont, extractPdfGraphics } from "../shared/core/pdf-document";
import type { PdfTextItem } from "../shared/core/pdf-document";

export async function readPdfPage(data: Uint8Array, pageNumber = 1) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: data.slice(), verbosity: 0, enableXfa: false });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const operatorList = await page.getOperatorList();
    const textContent = await page.getTextContent();
    const fontName = (id: string) => { try { return (page.commonObjs.get(id) as { name?: string } | undefined)?.name ?? ""; } catch { return ""; } };
    const items: PdfTextItem[] = textContent.items.flatMap((item) => {
      if (!("str" in item) || !item.str.trim()) return [];
      const font = describePdfFont(fontName(item.fontName));
      return [{ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height, fontName: item.fontName, hasEol: item.hasEOL, bold: font.bold, italic: font.italic, fontFamily: font.family }];
    });
    const graphics = extractPdfGraphics(operatorList.fnArray, operatorList.argsArray, pdfjs.OPS as unknown as Record<string, number>);
    return { width: viewport.width, height: viewport.height, items, graphics, numPages: pdf.numPages };
  } finally {
    await task.destroy();
  }
}
