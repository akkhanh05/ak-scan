/** Packs RGBA pixels into 1-bit rows (MSB first, 1 = white) for PDF DeviceGray images. */
export function packBilevel(rgba: Uint8ClampedArray, width: number, height: number, threshold = 128) {
  const stride = Math.ceil(width / 8);
  const bits = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luminance = rgba[i] * .299 + rgba[i + 1] * .587 + rgba[i + 2] * .114;
      if (luminance >= threshold) bits[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return bits;
}
