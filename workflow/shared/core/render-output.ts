/** Encodes a rendered surface for transfer (worker) or direct use (main thread). */
import { packBilevel } from "./bilevel";
import type { RenderOutput, RenderResult } from "./render-protocol";
import { get2d } from "./scan";
import type { Surface } from "./scan";

async function toBlob(surface: Surface, type: string, quality?: number): Promise<Blob> {
  if ("convertToBlob" in surface) return surface.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) => (surface as HTMLCanvasElement).toBlob((blob) => blob ? resolve(blob) : reject(new Error("Trình duyệt không thể mã hóa ảnh trang.")), type, quality));
}

export async function encodeSurface(surface: Surface, output: RenderOutput): Promise<{ result: RenderResult; transfer: Transferable[] }> {
  const size = { width: surface.width, height: surface.height };
  if (output.kind === "bitmap") {
    const bitmap = "transferToImageBitmap" in surface ? surface.transferToImageBitmap() : await createImageBitmap(surface);
    return { result: { ...size, bitmap }, transfer: [bitmap] };
  }
  if (output.kind === "bilevel") {
    const ctx = get2d(surface, { willReadFrequently: true });
    if (!ctx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh.");
    const bits = packBilevel(ctx.getImageData(0, 0, surface.width, surface.height).data, surface.width, surface.height).buffer as ArrayBuffer;
    return { result: { ...size, bits }, transfer: [bits] };
  }
  const mime = output.kind === "jpeg" ? "image/jpeg" : "image/png";
  const blob = await toBlob(surface, mime, output.kind === "jpeg" ? output.quality : undefined);
  if (!blob.size) throw new Error("Trình duyệt không thể mã hóa ảnh trang.");
  const bytes = await blob.arrayBuffer();
  return { result: { ...size, bytes, mime }, transfer: [bytes] };
}
