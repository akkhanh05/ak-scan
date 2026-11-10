export type SupportedUploadKind = "jpeg" | "png" | "webp" | "pdf";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// Directional controls can disguise extensions (for example, "photo\u202Egpj.exe").
// They have no useful purpose in a filename displayed by this application.
const FILENAME_FORMATTING_CHARACTERS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

export async function detectUploadKind(file: File): Promise<SupportedUploadKind | null> {
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  // A PNG always starts with a 13-byte IHDR chunk. Checking it avoids accepting
  // a bare signature pasted onto arbitrary content while retaining valid PNGs.
  if (bytes.length >= 24 && pngSignature.every((value, index) => bytes[index] === value)
    && bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0 && bytes[11] === 13
    && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52) return "png";
  // RIFF's declared size must include the WEBP FourCC (at minimum 4 bytes).
  const riffSize = bytes.length >= 8 ? bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24) : 0;
  if (bytes.length >= 16 && riffSize >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  const marker = [0x25, 0x50, 0x44, 0x46, 0x2d];
  for (let offset = 0; offset <= bytes.length - marker.length; offset++) {
    if (marker.every((value, index) => bytes[offset + index] === value)
      && bytes[offset + 5] === 0x31 && bytes[offset + 6] === 0x2e
      && bytes[offset + 7] >= 0x30 && bytes[offset + 7] <= 0x39) return "pdf";
  }
  return null;
}

/**
 * Reads the pixel size from the image header without decoding the image, so an
 * oversized picture is rejected before the browser allocates its bitmap.
 * JPEG: first SOFn segment; PNG: IHDR; WebP: VP8/VP8L/VP8X.
 */
export function imageDimensionsFromHeader(bytes: Uint8Array, kind: SupportedUploadKind): { width: number; height: number } | null {
  const u16be = (offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
  const u24le = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  if (kind === "png" && bytes.length >= 24) {
    const width = ((bytes[16] << 24) >>> 0) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19];
    const height = ((bytes[20] << 24) >>> 0) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23];
    return width && height ? { width, height } : null;
  }
  if (kind === "webp" && bytes.length >= 30) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === "VP8 ") return { width: ((bytes[27] << 8) | bytes[26]) & 0x3fff, height: ((bytes[29] << 8) | bytes[28]) & 0x3fff };
    if (chunk === "VP8L") {
      const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
    if (chunk === "VP8X") return { width: 1 + u24le(24), height: 1 + u24le(27) };
    return null;
  }
  if (kind === "jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = u16be(offset + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        const height = u16be(offset + 5), width = u16be(offset + 7);
        return width && height ? { width, height } : null;
      }
      if (marker === 0xda || length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}

/** Reads enough of the file to parse the header (JPEG EXIF can precede SOF). */
export async function readImageDimensions(file: Blob, kind: SupportedUploadKind) {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer());
  return imageDimensionsFromHeader(bytes, kind);
}

export function safeDisplayName(name: string) {
  const cleaned = name.normalize("NFC").replace(CONTROL_CHARACTERS, "").replace(FILENAME_FORMATTING_CHARACTERS, "").trim();
  return (cleaned || "Tài liệu không tên").slice(0, 160);
}

export function sanitizeDocumentText(text: string) {
  const cleaned = text.replace(CONTROL_CHARACTERS, "");
  let result = "";
  for (const character of cleaned) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0xd800 || codePoint > 0xdfff) result += character;
    if (result.length >= 2_000_000) break;
  }
  return result;
}

export function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** The small portion of an OCR worker needed to safely stop work in progress. */
export type TerminableOcrWorker = { terminate: () => Promise<unknown> | unknown };

/**
 * OCR work happens in a Web Worker and a promise timeout alone would leave that
 * worker consuming CPU/RAM in the background. Terminate it before propagating
 * a recognition failure or timeout so the caller cannot silently continue it.
 */
export async function withOcrTimeout<T>(worker: TerminableOcrWorker, recognition: Promise<T>, milliseconds: number, message: string): Promise<T> {
  try {
    return await withTimeout(recognition, milliseconds, message);
  } catch (error) {
    try { await worker.terminate(); } catch { /* A worker may already be stopped by a user cancellation. */ }
    throw error;
  }
}

