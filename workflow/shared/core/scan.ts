import "client-only";
import type { PdfTextItem } from "./ocr";

export type FilterName = "enhanced" | "original" | "grayscale" | "bw";

/** Select genuinely different image preparations for uncertain scan OCR. */
export function ocrPreprocessFilters(confidence: number): Array<Extract<FilterName, "grayscale" | "enhanced" | "bw">> {
  if (confidence >= 96) return ["grayscale"];
  if (confidence >= 91) return ["grayscale", "enhanced"];
  return ["grayscale", "enhanced", "bw"];
}
export type Point = { x: number; y: number };
export type Corners = [Point, Point, Point, Point];

export interface ScanSettings {
  filter: FilterName;
  brightness: number;
  contrast: number;
  whiten: number;
  sharpen: number;
  removeShadow: number;
}

export interface ScanPage {
  id: string;
  name: string;
  url: string;
  rotation: number;
  fineRotation?: number;
  dewarp?: boolean;
  corners: Corners;
  settings: ScanSettings;
  qualityWarning?: string;
  embeddedText?: string;
  embeddedTextItems?: PdfTextItem[];
  pdfKind?: "document" | "scan";
  sourcePixels?: number;
}

export const defaultCorners: Corners = [
  { x: 0.005, y: 0.005 }, { x: 0.995, y: 0.005 },
  { x: 0.995, y: 0.995 }, { x: 0.005, y: 0.995 }
];

export const defaultSettings: ScanSettings = {
  filter: "original",
  brightness: 0,
  contrast: 0,
  whiten: 0,
  sharpen: 0,
  removeShadow: 0
};

export interface DetectionResult { corners: Corners; confidence: number; }
export interface QualityResult { warning?: string; sharpness: number; }
export interface TableGrid { xLines: number[]; yLines: number[]; }

async function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Không thể đọc ảnh này.")); image.src = url;
  });
}

export function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * ratio)))] ?? 0;
}

export async function analyzeImageQuality(url: string, width: number, height: number): Promise<QualityResult> {
  const image = await loadImage(url);
  const scale = Math.min(1, 380 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { warning: "Không thể kiểm tra chất lượng", sharpness: 0 };
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const gray = new Float32Array(canvas.width * canvas.height);
  let dark = 0, blown = 0;
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel++) {
    const value = data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114;
    gray[pixel] = value;
    if (value < 38) dark++;
    if (value > 250) blown++;
  }
  let laplacianSum = 0, laplacianSquaredSum = 0, samples = 0;
  for (let y = 1; y < canvas.height - 1; y++) for (let x = 1; x < canvas.width - 1; x++) {
    const i = y * canvas.width + x;
    const laplacian = gray[i - 1] + gray[i + 1] + gray[i - canvas.width] + gray[i + canvas.width] - 4 * gray[i];
    laplacianSum += laplacian;
    laplacianSquaredSum += laplacian * laplacian;
    samples++;
  }
  const mean = laplacianSum / Math.max(1, samples);
  const sharpness = laplacianSquaredSum / Math.max(1, samples) - mean * mean;
  const warnings: string[] = [];
  if (Math.min(width, height) < 1000) warnings.push("Độ phân giải thấp");
  if (sharpness < 42) warnings.push("Ảnh có thể bị mờ/rung");
  if (dark / gray.length > .28) warnings.push("Ảnh thiếu sáng");
  const blownRatio = blown / gray.length;
  if (blownRatio > .05 && blownRatio < .42) warnings.push("Có vùng lóa sáng");
  return { warning: warnings.slice(0, 2).join(" · ") || undefined, sharpness };
}

export function detectTableGrid(canvas: HTMLCanvasElement): TableGrid | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const dark = (x: number, y: number) => {
    const i = (y * canvas.width + x) * 4;
    return pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114 < 120;
  };
  const groupPeaks = (scores: number[], threshold: number) => {
    const peaks: number[] = [];
    let start = -1, best = -1, bestScore = -1;
    for (let index = 0; index <= scores.length; index++) {
      if (index < scores.length && scores[index] >= threshold) {
        if (start < 0) start = index;
        if (scores[index] > bestScore) { best = index; bestScore = scores[index]; }
      } else if (start >= 0) {
        peaks.push(best);
        start = best = -1;
        bestScore = -1;
      }
    }
    return peaks;
  };
  const horizontal = new Array<number>(canvas.height).fill(0);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x += 2) if (dark(x, y)) horizontal[y]++;
  const yLines = groupPeaks(horizontal, canvas.width * .21);
  if (yLines.length < 2) return null;
  let bestStart = 0, bestEnd = 1;
  for (let start = 0; start < yLines.length - 1; start++) for (let end = start + 1; end < yLines.length; end++) {
    if (yLines[end] - yLines[start] > yLines[bestEnd] - yLines[bestStart]) { bestStart = start; bestEnd = end; }
  }
  const selectedY = yLines.slice(bestStart, bestEnd + 1);
  const tableHeight = selectedY[selectedY.length - 1] - selectedY[0];
  if (tableHeight < canvas.height * .025) return null;
  const vertical = new Array<number>(canvas.width).fill(0);
  for (let x = 0; x < canvas.width; x++) for (let y = selectedY[0]; y <= selectedY[selectedY.length - 1]; y += 2) if (dark(x, y)) vertical[x]++;
  const xLines = groupPeaks(vertical, tableHeight * .22);
  if (xLines.length < 2) return null;
  const width = xLines[xLines.length - 1] - xLines[0];
  if (width < canvas.width * .3) return null;
  return { xLines, yLines: selectedY };
}

async function detectDocumentCornersLegacy(url: string): Promise<DetectionResult> {
  const image = await loadImage(url);
  const scale = Math.min(1, 420 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) throw new Error("Không thể phân tích ảnh.");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const luminance = new Float32Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) luminance[p] = data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114;
  const border: number[] = [];
  for (let x = 0; x < canvas.width; x += 3) { border.push(luminance[x], luminance[(canvas.height - 1) * canvas.width + x]); }
  for (let y = 0; y < canvas.height; y += 3) { border.push(luminance[y * canvas.width], luminance[y * canvas.width + canvas.width - 1]); }
  const background = percentile(border, .5);
  const samples: Array<{ x: number; y: number; delta: number }> = [];
  const step = 2;
  for (let y = step; y < canvas.height - step; y += step) for (let x = step; x < canvas.width - step; x += step) {
    const value = luminance[y * canvas.width + x]; const delta = Math.abs(value - background);
    if (delta > 24) samples.push({ x, y, delta });
  }
  if (samples.length < (canvas.width * canvas.height) / 80) return { corners: defaultCorners.map((p) => ({ ...p })) as Corners, confidence: .12 };
  const xs = samples.map((p) => p.x), ys = samples.map((p) => p.y);
  const left = percentile(xs, .025), right = percentile(xs, .975), top = percentile(ys, .025), bottom = percentile(ys, .975);
  const band = Math.max(8, Math.round((bottom - top) * .08));
  const topPoints = samples.filter((p) => p.y <= top + band), bottomPoints = samples.filter((p) => p.y >= bottom - band);
  const q = (points: typeof samples, axis: "x", ratio: number, fallback: number) => points.length ? percentile(points.map((p) => p[axis]), ratio) : fallback;
  const tlX = q(topPoints, "x", .04, left), trX = q(topPoints, "x", .96, right), blX = q(bottomPoints, "x", .04, left), brX = q(bottomPoints, "x", .96, right);
  const sideBand = Math.max(8, Math.round((right - left) * .055));
  const edgeY = (x: number, ratio: number, fallback: number) => { const near = samples.filter((p) => Math.abs(p.x - x) <= sideBand); return near.length ? percentile(near.map((p) => p.y), ratio) : fallback; };
  const corners: Corners = [
    { x: tlX / canvas.width, y: edgeY(tlX, .025, top) / canvas.height },
    { x: trX / canvas.width, y: edgeY(trX, .025, top) / canvas.height },
    { x: brX / canvas.width, y: edgeY(brX, .975, bottom) / canvas.height },
    { x: blX / canvas.width, y: edgeY(blX, .975, bottom) / canvas.height }
  ];
  const area = ((right - left) * (bottom - top)) / (canvas.width * canvas.height);
  const contrast = percentile(samples.map((p) => p.delta), .6);
  const confidence = Math.max(.1, Math.min(.92, area * .75 + Math.min(contrast / 120, .3)));
  return { corners, confidence };
}

export type DetectedLine = { a: number; b: number; c: number; score: number };

export function scoreDocumentBoundary(rawScore: number, positionRatio: number, insideLuminance: number, outsideLuminance: number) {
  // Camera frames, table seams and book borders frequently form stronger lines
  // than the paper itself. Lines very close to the image boundary therefore
  // need stronger evidence before they can be treated as document edges.
  const edgeDistance = Math.min(positionRatio, 1 - positionRatio);
  const insetWeight = .4 + .6 * Math.min(1, Math.max(0, edgeDistance) / .1);
  // A normal sheet is usually brighter immediately inside its edge. Keep a
  // small neutral floor so coloured/dark documents are still detectable.
  const paperContrast = Math.max(-.15, Math.min(.65, (insideLuminance - outsideLuminance) / 45));
  return rawScore * insetWeight * (.82 + paperContrast);
}

export function intersectLines(first: DetectedLine, second: DetectedLine): Point | null {
  const determinant = first.a * second.b - second.a * first.b;
  if (Math.abs(determinant) < .08) return null;
  return {
    x: (first.c * second.b - second.c * first.b) / determinant,
    y: (first.a * second.c - second.a * first.c) / determinant,
  };
}

export async function detectDocumentCorners(url: string): Promise<DetectionResult> {
  const image = await loadImage(url);
  const scale = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return detectDocumentCornersLegacy(url);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const luminance = new Float32Array(canvas.width * canvas.height);
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel++) {
    luminance[pixel] = data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114;
  }

  const strengths: number[] = [];
  for (let y = 1; y < canvas.height - 1; y++) for (let x = 1; x < canvas.width - 1; x++) {
    const i = y * canvas.width + x;
    const gx = -luminance[i - canvas.width - 1] + luminance[i - canvas.width + 1]
      - 2 * luminance[i - 1] + 2 * luminance[i + 1]
      - luminance[i + canvas.width - 1] + luminance[i + canvas.width + 1];
    const gy = -luminance[i - canvas.width - 1] - 2 * luminance[i - canvas.width] - luminance[i - canvas.width + 1]
      + luminance[i + canvas.width - 1] + 2 * luminance[i + canvas.width] + luminance[i + canvas.width + 1];
    strengths.push(Math.hypot(gx, gy));
  }
  const threshold = Math.max(55, percentile(strengths, .88));
  const edges: Array<{ x: number; y: number; strength: number }> = [];
  let strengthIndex = 0;
  for (let y = 1; y < canvas.height - 1; y++) for (let x = 1; x < canvas.width - 1; x++, strengthIndex++) {
    const strength = strengths[strengthIndex];
    if (strength >= threshold) edges.push({ x, y, strength: Math.min(255, strength) });
  }
  if (edges.length < 80) return detectDocumentCornersLegacy(url);

  const diagonal = Math.ceil(Math.hypot(canvas.width, canvas.height));
  const sampleStep = Math.max(1, Math.ceil(edges.length / 14000));
  const boundaryLuminance = (line: Pick<DetectedLine, "a" | "b" | "c">, orientation: "vertical" | "horizontal") => {
    const centerSide = Math.sign(line.a * canvas.width / 2 + line.b * canvas.height / 2 - line.c) || 1;
    const offset = Math.max(3, Math.round(Math.min(canvas.width, canvas.height) * .012));
    let inside = 0, outside = 0, count = 0;
    const samples = 36;
    for (let sample = 2; sample < samples - 2; sample++) {
      let x: number, y: number;
      if (orientation === "vertical") {
        y = sample / (samples - 1) * (canvas.height - 1);
        if (Math.abs(line.a) < .08) continue;
        x = (line.c - line.b * y) / line.a;
      } else {
        x = sample / (samples - 1) * (canvas.width - 1);
        if (Math.abs(line.b) < .08) continue;
        y = (line.c - line.a * x) / line.b;
      }
      const insideX = Math.round(x + line.a * centerSide * offset);
      const insideY = Math.round(y + line.b * centerSide * offset);
      const outsideX = Math.round(x - line.a * centerSide * offset);
      const outsideY = Math.round(y - line.b * centerSide * offset);
      if (insideX < 0 || insideX >= canvas.width || insideY < 0 || insideY >= canvas.height
        || outsideX < 0 || outsideX >= canvas.width || outsideY < 0 || outsideY >= canvas.height) continue;
      inside += luminance[insideY * canvas.width + insideX];
      outside += luminance[outsideY * canvas.width + outsideX];
      count++;
    }
    return count ? { inside: inside / count, outside: outside / count } : { inside: 128, outside: 128 };
  };
  const findPair = (angles: number[], orientation: "vertical" | "horizontal") => {
    let low: DetectedLine | null = null;
    let high: DetectedLine | null = null;
    for (const degree of angles) {
      const radians = degree * Math.PI / 180;
      const a = Math.cos(radians), b = Math.sin(radians);
      const accumulator = new Float32Array(diagonal * 2 + 1);
      for (let index = 0; index < edges.length; index += sampleStep) {
        const edge = edges[index];
        const rhoIndex = Math.round(edge.x * a + edge.y * b) + diagonal;
        if (rhoIndex >= 0 && rhoIndex < accumulator.length) accumulator[rhoIndex] += edge.strength;
      }
      for (let rhoIndex = 0; rhoIndex < accumulator.length; rhoIndex++) {
        if (accumulator[rhoIndex] <= 0) continue;
        const c = rhoIndex - diagonal;
        const position = orientation === "vertical"
          ? (c - b * canvas.height / 2) / a
          : (c - a * canvas.width / 2) / b;
        const size = orientation === "vertical" ? canvas.width : canvas.height;
        if (!Number.isFinite(position) || position < size * .015 || position > size * .985) continue;
        if (position > size * .47 && position < size * .53) continue;
        const provisional = { a, b, c };
        const tones = boundaryLuminance(provisional, orientation);
        const line = {
          ...provisional,
          score: scoreDocumentBoundary(accumulator[rhoIndex], position / size, tones.inside, tones.outside),
        };
        if (position < size / 2 && (!low || line.score > low.score)) low = line;
        if (position > size / 2 && (!high || line.score > high.score)) high = line;
      }
    }
    return [low, high] as const;
  };

  const verticalAngles = [...Array.from({ length: 36 }, (_, index) => index), ...Array.from({ length: 35 }, (_, index) => 145 + index)];
  const horizontalAngles = Array.from({ length: 71 }, (_, index) => 55 + index);
  const [left, right] = findPair(verticalAngles, "vertical");
  const [top, bottom] = findPair(horizontalAngles, "horizontal");
  if (!left || !right || !top || !bottom) return detectDocumentCornersLegacy(url);

  const raw = [intersectLines(left, top), intersectLines(right, top), intersectLines(right, bottom), intersectLines(left, bottom)];
  if (raw.some((point) => !point)) return detectDocumentCornersLegacy(url);
  const margin = .08;
  const corners = raw.map((point) => ({
    x: Math.max(-margin, Math.min(1 + margin, point!.x / canvas.width)),
    y: Math.max(-margin, Math.min(1 + margin, point!.y / canvas.height)),
  })) as Corners;
  const area = Math.abs(corners.reduce((sum, point, index) => {
    const next = corners[(index + 1) % corners.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
  if (area < .18) return detectDocumentCornersLegacy(url);
  const weakestLine = Math.min(left.score, right.score, top.score, bottom.score);
  const normalizedLineScore = weakestLine / Math.max(1, edges.length / sampleStep * 80);
  return { corners, confidence: Math.max(.3, Math.min(.96, .42 + area * .35 + normalizedLineScore * .2)) };
}

export function canvasFilter(settings: ScanSettings) {
  // Enhanced mode performs its tone mapping after perspective correction so it
  // can use a local paper/background estimate instead of a global CSS filter.
  if (settings.filter === "enhanced" || settings.filter === "grayscale" || settings.filter === "bw") return "none";
  const saturation = settings.filter === "original" ? 1 : 0;
  const contrast = 100 + settings.contrast;
  const brightness = 100 + settings.brightness + settings.whiten * 0.18;
  return `grayscale(${1 - saturation}) contrast(${contrast}%) brightness(${brightness}%)`;
}

export function correctShadowChannel(original: number, localPaper: number, shadowStrength: number) {
  const paper = Math.max(18, localPaper);
  const ratioCorrected = original * 242 / paper;
  const additiveCorrected = original + (242 - paper);
  // Multiplication works for ordinary gradients; additive correction is needed
  // for deep phone/camera shadows where near-black pixels cannot recover by
  // multiplication alone. Both preserve the local ink-to-paper difference.
  const deepShadow = Math.max(0, Math.min(1, (225 - paper) / 110));
  const corrected = ratioCorrected * (1 - deepShadow) + additiveCorrected * deepShadow;
  return original * (1 - shadowStrength) + corrected * shadowStrength;
}

export function protectInkFromShadowRemoval(shadowStrength: number, centerLuminance: number, neighborLuminance: number) {
  const detailContrast = neighborLuminance - centerLuminance;
  const inkEvidence = Math.max(0, Math.min(.92, (detailContrast - 12) / 42));
  return shadowStrength * (1 - inkEvidence);
}

export function shouldPreserveDocumentColor(red: number, green: number, blue: number) {
  const maximum = Math.max(red, green, blue);
  const chroma = maximum - Math.min(red, green, blue);
  return chroma >= 28 && chroma / Math.max(1, maximum) >= .18;
}

export function isDarkInkOnColoredSurface(
  red: number, green: number, blue: number,
  surfaceRed: number, surfaceGreen: number, surfaceBlue: number,
) {
  const inkLuminance = red * .299 + green * .587 + blue * .114;
  const surfaceLuminance = surfaceRed * .299 + surfaceGreen * .587 + surfaceBlue * .114;
  const surfaceChroma = Math.max(surfaceRed, surfaceGreen, surfaceBlue) - Math.min(surfaceRed, surfaceGreen, surfaceBlue);
  return surfaceChroma >= 24 && inkLuminance <= 155 && surfaceLuminance - inkLuminance >= 14;
}

export function restoreColoredSurfaceChannel(channel: number, surfaceLuminance: number, lift: number) {
  const restoredLuminance = Math.min(190, surfaceLuminance * 1.08 + Math.max(0, lift) * .12);
  return channel * restoredLuminance / Math.max(1, surfaceLuminance);
}

export function estimateDocumentShadowSeverity(background: Uint8ClampedArray) {
  const neutralLuminance: number[] = [];
  for (let i = 0; i < background.length; i += 4) {
    const red = background[i], green = background[i + 1], blue = background[i + 2];
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 22) continue;
    neutralLuminance.push(red * .299 + green * .587 + blue * .114);
  }
  if (neutralLuminance.length < 16) return 0;
  const darkPaper = percentile(neutralLuminance, .08);
  const normalPaper = percentile(neutralLuminance, .62);
  // A clean scan can contain black text and coloured table cells, but after the
  // background blur those details occupy little of the neutral paper map. A
  // real phone/hand shadow creates a broad low-frequency luminance gap.
  const absoluteDarkness = Math.max(0, (188 - darkPaper) / 105);
  const unevenness = Math.max(0, (normalPaper - darkPaper - 38) / 105);
  return Math.max(0, Math.min(1, Math.max(absoluteDarkness, unevenness)));
}

function enhanceCleanDocumentClassic(canvas: HTMLCanvasElement, settings: ScanSettings) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const mapWidth = Math.min(96, canvas.width);
  const mapHeight = Math.max(1, Math.round(canvas.height / Math.max(canvas.width, 1) * mapWidth));
  const reduced = document.createElement("canvas");
  reduced.width = mapWidth; reduced.height = mapHeight;
  const reducedCtx = reduced.getContext("2d");
  if (!reducedCtx) return;
  reducedCtx.imageSmoothingEnabled = true;
  reducedCtx.imageSmoothingQuality = "high";
  reducedCtx.drawImage(canvas, 0, 0, mapWidth, mapHeight);
  const background = document.createElement("canvas");
  background.width = mapWidth; background.height = mapHeight;
  const backgroundCtx = background.getContext("2d", { willReadFrequently: true });
  if (!backgroundCtx) return;
  backgroundCtx.filter = `blur(${Math.max(3, Math.round(mapWidth / 24))}px)`;
  backgroundCtx.drawImage(reduced, 0, 0);
  backgroundCtx.filter = "none";
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  const map = backgroundCtx.getImageData(0, 0, mapWidth, mapHeight).data;
  const shadowStrength = Math.min(1, .62 + settings.removeShadow / 90);
  const contrast = 1.12 + settings.contrast / 160;
  const whitePoint = 242 - settings.whiten * .22;
  const lift = settings.brightness * .55 + settings.whiten * .32;
  for (let y = 0; y < canvas.height; y++) {
    const mapY = Math.min(mapHeight - 1, Math.round(y / Math.max(canvas.height - 1, 1) * (mapHeight - 1)));
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const mapX = Math.min(mapWidth - 1, Math.round(x / Math.max(canvas.width - 1, 1) * (mapWidth - 1)));
      const mi = (mapY * mapWidth + mapX) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const original = pixels[i + channel];
        const localPaper = Math.max(36, map[mi + channel]);
        const divided = original * 248 / localPaper;
        const balanced = original * (1 - shadowStrength) + divided * shadowStrength;
        const value = (balanced - 210) * contrast + 226 + lift;
        pixels[i + channel] = value >= whitePoint ? 255 : Math.max(0, Math.min(255, value));
      }
      pixels[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function enhanceDocument(canvas: HTMLCanvasElement, settings: ScanSettings) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  // Keep enough spatial detail to capture narrow phone/hand shadows. At this
  // scale a 3px blur removes glyphs but does not average a dark shadow into the
  // surrounding white sheet as the old 96px map did.
  const mapWidth = Math.min(384, canvas.width);
  const mapHeight = Math.max(1, Math.round(canvas.height / Math.max(canvas.width, 1) * mapWidth));
  const reduced = document.createElement("canvas");
  reduced.width = mapWidth;
  reduced.height = mapHeight;
  const reducedCtx = reduced.getContext("2d");
  if (!reducedCtx) return;
  reducedCtx.imageSmoothingEnabled = true;
  reducedCtx.imageSmoothingQuality = "high";
  reducedCtx.drawImage(canvas, 0, 0, mapWidth, mapHeight);

  // Blur at map scale removes letters and table lines, leaving the colour and
  // brightness of the paper under each area of the photographed page.
  const background = document.createElement("canvas");
  background.width = mapWidth;
  background.height = mapHeight;
  const backgroundCtx = background.getContext("2d", { willReadFrequently: true });
  if (!backgroundCtx) return;
  backgroundCtx.filter = `blur(${Math.max(4, Math.round(mapWidth / 96))}px)`;
  backgroundCtx.drawImage(reduced, 0, 0);
  backgroundCtx.filter = "none";

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  const sourcePixels = new Uint8ClampedArray(pixels);
  const map = backgroundCtx.getImageData(0, 0, mapWidth, mapHeight).data;
  const shadowSeverity = estimateDocumentShadowSeverity(map);
  // Ordinary phone illumination (including the reference blue-table page) can
  // score around .55 and is handled better by the classic 96px background map.
  // Reserve the aggressive branch for genuinely severe/localized shadows.
  const needsDeepShadowRemoval = shadowSeverity >= .68;
  if (!needsDeepShadowRemoval) {
    enhanceCleanDocumentClassic(canvas, settings);
    return false;
  }
  const shadowStrength = Math.min(1, .62 + settings.removeShadow / 90);
  const contrast = 1.12 + settings.contrast / 160;
  const whitePoint = 242 - settings.whiten * .22;
  const lift = settings.brightness * .55 + settings.whiten * .32;

  for (let y = 0; y < canvas.height; y++) {
    const mapY = Math.min(mapHeight - 1, Math.round(y / Math.max(canvas.height - 1, 1) * (mapHeight - 1)));
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const mapX = Math.min(mapWidth - 1, Math.round(x / Math.max(canvas.width - 1, 1) * (mapWidth - 1)));
      const mi = (mapY * mapWidth + mapX) * 4;

      const originalRed = sourcePixels[i], originalGreen = sourcePixels[i + 1], originalBlue = sourcePixels[i + 2];

      const originalLuminance = originalRed * .299 + originalGreen * .587 + originalBlue * .114;
      const preserveColour = shouldPreserveDocumentColor(originalRed, originalGreen, originalBlue);
      let neighborLuminance = 0, neighborCount = 0;
      for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= canvas.width || ny < 0 || ny >= canvas.height) continue;
        const ni = (ny * canvas.width + nx) * 4;
        neighborLuminance += sourcePixels[ni] * .299 + sourcePixels[ni + 1] * .587 + sourcePixels[ni + 2] * .114;
        neighborCount++;
      }
      neighborLuminance /= Math.max(1, neighborCount);
      const protectedShadowStrength = protectInkFromShadowRemoval(shadowStrength, originalLuminance, neighborLuminance);
      const corrected = [0, 0, 0];

      if (preserveColour) {
        // Correct only luminance for coloured cells, stamps and highlights. A
        // common RGB scale keeps their hue instead of bleaching them to white.
        const localLuminance = map[mi] * .299 + map[mi + 1] * .587 + map[mi + 2] * .114;
        const balancedLuminance = correctShadowChannel(originalLuminance, localLuminance, protectedShadowStrength);
        const targetLuminance = Math.max(0, Math.min(235, (balancedLuminance - 210) * contrast + 226 + lift));
        // The reference scan keeps the blue cell deep rather than turning it
        // into bright cyan. Coloured regions therefore receive only a modest
        // exposure lift; neutral paper still uses the full cleaning pipeline.
        const colourScale = Math.min(1.3, targetLuminance / Math.max(1, originalLuminance));
        corrected[0] = Math.min(255, originalRed * colourScale);
        corrected[1] = Math.min(255, originalGreen * colourScale);
        corrected[2] = Math.min(255, originalBlue * colourScale);
      } else {
        for (let channel = 0; channel < 3; channel++) {
          const original = sourcePixels[i + channel];
          const localPaper = map[mi + channel];
          const balanced = correctShadowChannel(original, localPaper, protectedShadowStrength);
          const value = (balanced - 210) * contrast + 226 + lift;
          corrected[channel] = Math.max(0, Math.min(255, value));
        }
      }
      const correctedLuminance = corrected[0] * .299 + corrected[1] * .587 + corrected[2] * .114;
      if (!preserveColour && correctedLuminance >= whitePoint) {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      } else {
        pixels[i] = corrected[0]; pixels[i + 1] = corrected[1]; pixels[i + 2] = corrected[2];
      }
      pixels[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return true;
}

function convertToGrayscale(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.round(image.data[i] * .299 + image.data[i + 1] * .587 + image.data[i + 2] * .114);
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

export function distance(a: Point, b: Point, width: number, height: number) {
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
}

export function projectUnitToQuad(corners: Corners, u: number, v: number): Point {
  const [p0, p1, p2, p3] = corners;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(denominator) < 1e-8 ? 0 : (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = Math.abs(denominator) < 1e-8 ? 0 : (dx1 * dy3 - dx3 * dy1) / denominator;
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y;
  const scale = 1 + g * u + h * v;
  return { x: (p0.x + a * u + b * v) / scale, y: (p0.y + d * u + e * v) / scale };
}

function warpPerspective(source: HTMLCanvasElement, corners: Corners, maxEdge: number) {
  const wantedW = Math.max(distance(corners[0], corners[1], source.width, source.height), distance(corners[3], corners[2], source.width, source.height));
  const wantedH = Math.max(distance(corners[0], corners[3], source.width, source.height), distance(corners[1], corners[2], source.width, source.height));
  const scale = Math.min(1, maxEdge / Math.max(wantedW, wantedH));
  const width = Math.max(1, Math.round(wantedW * scale));
  const height = Math.max(1, Math.round(wantedH * scale));
  const output = document.createElement("canvas");
  output.width = width; output.height = height;
  const out = output.getContext("2d", { alpha: false });
  if (!out) throw new Error("Trình duyệt không hỗ trợ chỉnh phối cảnh.");
  out.imageSmoothingEnabled = true;
  out.imageSmoothingQuality = "high";
  out.fillStyle = "white"; out.fillRect(0, 0, width, height);
  const grid = maxEdge <= 1200 ? 10 : 18;
  type PixelPoint = { x: number; y: number };
  const transformTriangle = (src: [PixelPoint, PixelPoint, PixelPoint], dst: [PixelPoint, PixelPoint, PixelPoint]) => {
    const [s0, s1, s2] = src, [d0, d1, d2] = dst;
    const den = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y); if (Math.abs(den) < .001) return;
    const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / den;
    const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / den;
    const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / den;
    const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / den;
    const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / den;
    const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / den;
    // Canvas clips anti-aliased triangle edges with partial transparency. Exact
    // neighbouring triangles therefore leave bright diagonal seams in scans.
    // Expand only the clip path by one pixel; the geometric transform remains
    // unchanged, so adjacent pieces overlap without shifting document content.
    const center = { x: (d0.x + d1.x + d2.x) / 3, y: (d0.y + d1.y + d2.y) / 3 };
    const expand = (point: PixelPoint) => {
      const dx = point.x - center.x, dy = point.y - center.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      return { x: point.x + dx / length, y: point.y + dy / length };
    };
    const e0 = expand(d0), e1 = expand(d1), e2 = expand(d2);
    out.save(); out.beginPath(); out.moveTo(e0.x, e0.y); out.lineTo(e1.x, e1.y); out.lineTo(e2.x, e2.y); out.closePath(); out.clip(); out.setTransform(a, b, c, d, e, f); out.drawImage(source, 0, 0); out.restore();
  };
  for (let row = 0; row < grid; row++) for (let column = 0; column < grid; column++) {
    const u0 = column / grid, v0 = row / grid, u1 = (column + 1) / grid, v1 = (row + 1) / grid;
    const sourcePoint = (u: number, v: number) => { const p = projectUnitToQuad(corners, u, v); return { x: p.x * source.width, y: p.y * source.height }; };
    const s00 = sourcePoint(u0, v0), s10 = sourcePoint(u1, v0), s11 = sourcePoint(u1, v1), s01 = sourcePoint(u0, v1);
    const d00 = { x: u0 * width, y: v0 * height }, d10 = { x: u1 * width, y: v0 * height }, d11 = { x: u1 * width, y: v1 * height }, d01 = { x: u0 * width, y: v1 * height };
  transformTriangle([s00, s10, s11], [d00, d10, d11]); transformTriangle([s00, s11, s01], [d00, d11, d01]);
  }
  return output;
}

const skewAngleCache = new Map<string, number>();
const curvatureCache = new Map<string, number[] | null>();

function estimatePageCurvature(canvas: HTMLCanvasElement, cacheKey: string): number[] | null {
  if (curvatureCache.has(cacheKey)) return curvatureCache.get(cacheKey) ?? null;
  const scale = Math.min(1, 560 / Math.max(canvas.width, canvas.height));
  const sample = document.createElement("canvas");
  sample.width = Math.max(1, Math.round(canvas.width * scale));
  sample.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
  const gray = new Float32Array(sample.width * sample.height);
  for (let i = 0, pixel = 0; i < pixels.length; i += 4, pixel++) gray[pixel] = pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114;

  const stripCount = 24;
  const profiles = Array.from({ length: stripCount }, () => new Float32Array(sample.height));
  const global = new Float32Array(sample.height);
  for (let strip = 0; strip < stripCount; strip++) {
    const x0 = Math.floor(strip * sample.width / stripCount);
    const x1 = Math.max(x0 + 1, Math.floor((strip + 1) * sample.width / stripCount));
    for (let y = 2; y < sample.height - 2; y++) {
      let strength = 0;
      for (let x = x0; x < x1; x += 2) {
        const i = y * sample.width + x;
        strength += Math.abs(gray[i + sample.width] - gray[i - sample.width]);
      }
      profiles[strip][y] = strength;
      global[y] += strength;
    }
  }

  const smooth = (profile: Float32Array) => {
    const result = new Float32Array(profile.length);
    for (let y = 2; y < profile.length - 2; y++) result[y] = (profile[y - 2] + 2 * profile[y - 1] + 3 * profile[y] + 2 * profile[y + 1] + profile[y + 2]) / 9;
    return result;
  };
  const smoothGlobal = smooth(global);
  const maxShift = Math.max(4, Math.min(24, Math.round(sample.height * .045)));
  const rawOffsets: number[] = [];
  for (const originalProfile of profiles) {
    const profile = smooth(originalProfile);
    const start = Math.max(maxShift + 2, Math.round(sample.height * .06));
    const end = Math.min(sample.height - maxShift - 2, Math.round(sample.height * .94));
    let meanProfile = 0, meanGlobal = 0;
    for (let y = start; y < end; y++) { meanProfile += profile[y]; meanGlobal += smoothGlobal[y]; }
    meanProfile /= Math.max(1, end - start); meanGlobal /= Math.max(1, end - start);
    const score = (shift: number) => {
      let value = 0;
      for (let y = start; y < end; y++) {
        const py = Math.max(0, Math.min(sample.height - 1, y + shift));
        value += (profile[py] - meanProfile) * (smoothGlobal[y] - meanGlobal);
      }
      return value;
    };
    const zeroScore = score(0);
    let bestShift = 0, bestScore = zeroScore;
    for (let shift = -maxShift; shift <= maxShift; shift++) {
      const candidate = score(shift);
      if (candidate > bestScore) { bestScore = candidate; bestShift = shift; }
    }
    rawOffsets.push(bestShift);
  }

  const N = rawOffsets.length;
  const S0 = N;
  let S4 = 0, S2 = 0, T2 = 0, T1 = 0, T0 = 0;
  for (let i = 0; i < N; i++) {
    const t = (2 * i) / (N - 1) - 1;
    const y = rawOffsets[i];
    const t2 = t * t;
    S4 += t2 * t2;
    S2 += t2;
    T2 += t2 * y;
    T1 += t * y;
    T0 += y;
  }
  const det = S4 * S0 - S2 * S2;
  let a = 0, b = 0, c = 0;
  if (Math.abs(det) > 1e-5) {
    a = (T2 * S0 - T0 * S2) / det;
    c = (S4 * T0 - S2 * T2) / det;
    b = T1 / Math.max(1e-5, S2);
  }

  const fitted: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = (2 * i) / (N - 1) - 1;
    fitted.push((a * t * t + b * t + c) / sample.height);
  }

  // Verify Quality of Parabolic Fit (R^2) & Curvature Magnitude (|a|)
  let SStot = 0, SSres = 0;
  const meanY = rawOffsets.reduce((sum, v) => sum + v, 0) / N;
  for (let i = 0; i < N; i++) {
    const t = (2 * i) / (N - 1) - 1;
    const yFitted = a * t * t + b * t + c;
    SSres += (rawOffsets[i] - yFitted) ** 2;
    SStot += (rawOffsets[i] - meanY) ** 2;
  }
  const rSquared = SStot > 1e-4 ? 1 - (SSres / SStot) : 0;
  const curveMagnitude = Math.abs(a);

  // Accept parabolic dewarp ONLY when document displays a true physical parabolic curve (R^2 >= 0.55 and |a| >= 1.8px on sample)
  const isValidPhysicalCurve = rSquared >= 0.55 && curveMagnitude >= 1.8;
  const result = isValidPhysicalCurve ? fitted : null;

  if (curvatureCache.size >= 40) curvatureCache.delete(curvatureCache.keys().next().value!);
  curvatureCache.set(cacheKey, result);
  return result;
}

function flattenCurvedPage(canvas: HTMLCanvasElement, cacheKey: string) {
  const offsets = estimatePageCurvature(canvas, cacheKey);
  if (!offsets) return canvas;
  const output = document.createElement("canvas");
  output.width = canvas.width;
  output.height = canvas.height;
  const ctx = output.getContext("2d", { alpha: false });
  if (!ctx) return canvas;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const meanOffset = offsets.reduce((sum, v) => sum + v, 0) / offsets.length;
  const slices = Math.min(canvas.width, 160);

  for (let slice = 0; slice < slices; slice++) {
    const u0 = slice / slices;
    const u1 = (slice + 1) / slices;
    const x0 = Math.floor(u0 * canvas.width);
    const x1 = Math.ceil(u1 * canvas.width);

    const position = (slice + 0.5) / slices * (offsets.length - 1);
    const left = Math.floor(position);
    const right = Math.min(offsets.length - 1, left + 1);
    const blend = position - left;

    const normOffset = (offsets[left] * (1 - blend) + offsets[right] * blend) - meanOffset;
    const pixelOffset = Math.max(-canvas.height * 0.05, Math.min(canvas.height * 0.05, normOffset * canvas.height));

    const overlap = 1.5;
    const sourceX = Math.max(0, x0 - overlap);
    const width = Math.min(canvas.width, x1 + overlap) - sourceX;

    ctx.drawImage(canvas, sourceX, 0, width, canvas.height, sourceX, -pixelOffset, width, canvas.height);
  }
  return output;
}

function estimateTextSkew(canvas: HTMLCanvasElement, cacheKey: string) {
  const cached = skewAngleCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const scale = Math.min(1, 620 / Math.max(canvas.width, canvas.height));
  const sample = document.createElement("canvas");
  sample.width = Math.max(1, Math.round(canvas.width * scale));
  sample.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
  const ink: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < sample.height - 1; y += 2) for (let x = 1; x < sample.width - 1; x += 2) {
    const i = (y * sample.width + x) * 4;
    const luminance = pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114;
    if (luminance < 145) ink.push({ x: x - sample.width / 2, y: y - sample.height / 2 });
  }
  if (ink.length < 120) return 0;

  const scoreAngle = (angle: number) => {
    const radians = angle * Math.PI / 180;
    const sine = Math.sin(radians), cosine = Math.cos(radians);
    const rows = new Uint32Array(sample.height + Math.ceil(sample.width * .3));
    const offset = Math.floor(rows.length / 2);
    for (const point of ink) {
      const row = Math.round(point.y * cosine + point.x * sine) + offset;
      if (row >= 0 && row < rows.length) rows[row]++;
    }
    let score = 0;
    for (let index = 1; index < rows.length; index++) {
      const difference = rows[index] - rows[index - 1];
      score += difference * difference;
    }
    return score;
  };

  const zeroScore = scoreAngle(0);
  let bestAngle = 0;
  let bestScore = zeroScore;
  for (let angle = -7; angle <= 7; angle += .25) {
    const score = scoreAngle(angle);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  const coarseAngle = bestAngle;
  for (let angle = coarseAngle - .3; angle <= coarseAngle + .3; angle += .05) {
    const score = scoreAngle(angle);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  // Require a meaningful improvement so photos, stamps and sparse pages do not
  // get rotated merely because of random dark pixels.
  const result = Math.abs(bestAngle) >= .18 && bestScore > zeroScore * 1.018 ? bestAngle : 0;
  if (skewAngleCache.size >= 40) skewAngleCache.delete(skewAngleCache.keys().next().value!);
  skewAngleCache.set(cacheKey, result);
  return result;
}

function straightenText(canvas: HTMLCanvasElement, cacheKey: string, fineRotation = 0) {
  const angle = estimateTextSkew(canvas, cacheKey) + fineRotation;
  if (angle === 0) return canvas;
  const output = document.createElement("canvas");
  output.width = canvas.width;
  output.height = canvas.height;
  const ctx = output.getContext("2d", { alpha: false });
  if (!ctx) return canvas;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.translate(output.width / 2, output.height / 2);
  const radians = angle * Math.PI / 180;
  const sine = Math.abs(Math.sin(radians)), cosine = Math.abs(Math.cos(radians));
  const rotatedWidth = canvas.width * cosine + canvas.height * sine;
  const rotatedHeight = canvas.width * sine + canvas.height * cosine;
  const fit = Math.min(1, canvas.width / rotatedWidth, canvas.height / rotatedHeight);
  ctx.rotate(radians);
  ctx.scale(fit, fit);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return output;
}

export function sharpenChannel(original: number, highPass: number, strength: number, darkOnly: boolean) {
  const sharpened = original * (1 - strength) + highPass * strength;
  return darkOnly ? Math.min(original, sharpened) : sharpened;
}

function sharpenCanvas(canvas: HTMLCanvasElement, amount: number, darkOnly = false) {
  if (amount <= 0) return;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const src = new Uint8ClampedArray(image.data);
  const strength = Math.min(.65, amount / 100);
  for (let y = 1; y < canvas.height - 1; y++) for (let x = 1; x < canvas.width - 1; x++) {
    const i = (y * canvas.width + x) * 4;
    for (let c = 0; c < 3; c++) {
      const center = src[i + c] * 5;
      const neighbors = src[i - 4 + c] + src[i + 4 + c] + src[i - canvas.width * 4 + c] + src[i + canvas.width * 4 + c];
      image.data[i + c] = sharpenChannel(src[i + c], center - neighbors, strength, darkOnly);
    }
  }
  ctx.putImageData(image, 0, 0);
}

function normalizeIllumination(canvas: HTMLCanvasElement, amount: number) {
  if (amount <= 0) return;
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const map = document.createElement("canvas"); const mapW = 48, mapH = Math.max(32, Math.round(48 * canvas.height / canvas.width));
  map.width = mapW; map.height = mapH; const mapCtx = map.getContext("2d", { willReadFrequently: true }); if (!mapCtx) return;
  mapCtx.drawImage(canvas, 0, 0, mapW, mapH); const image = mapCtx.getImageData(0, 0, mapW, mapH); const strength = amount / 100;
  for (let i = 0; i < image.data.length; i += 4) {
    const local = image.data[i] * .299 + image.data[i + 1] * .587 + image.data[i + 2] * .114;
    const lift = Math.max(0, Math.min(.34, (222 - local) / 255 * strength));
    image.data[i] = image.data[i + 1] = image.data[i + 2] = 255; image.data[i + 3] = Math.round(lift * 255);
  }
  mapCtx.putImageData(image, 0, 0); ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.filter = `blur(${Math.max(8, Math.round(Math.max(canvas.width, canvas.height) / 80))}px)`; ctx.drawImage(map, 0, 0, canvas.width, canvas.height); ctx.restore();
}

function binaryBlackWhite(canvas: HTMLCanvasElement, settings: ScanSettings) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = source.data;

  // Estimate the local surface colour. This lets a blue table cell become white
  // while retaining letters that are darker than that blue cell.
  const mapWidth = Math.min(160, canvas.width);
  const mapHeight = Math.max(1, Math.round(canvas.height / Math.max(canvas.width, 1) * mapWidth));
  const reduced = document.createElement("canvas");
  reduced.width = mapWidth;
  reduced.height = mapHeight;
  const reducedCtx = reduced.getContext("2d");
  if (!reducedCtx) return;
  reducedCtx.imageSmoothingEnabled = true;
  reducedCtx.imageSmoothingQuality = "high";
  reducedCtx.drawImage(canvas, 0, 0, mapWidth, mapHeight);
  const background = document.createElement("canvas");
  background.width = mapWidth;
  background.height = mapHeight;
  const backgroundCtx = background.getContext("2d", { willReadFrequently: true });
  if (!backgroundCtx) return;
  backgroundCtx.filter = "blur(2px)";
  backgroundCtx.drawImage(reduced, 0, 0);
  backgroundCtx.filter = "none";
  const localMap = backgroundCtx.getImageData(0, 0, mapWidth, mapHeight).data;

  const histogram = new Uint32Array(256);
  let luminanceSum = 0;
  const pixelCount = canvas.width * canvas.height;

  for (let i = 0; i < pixels.length; i += 4) {
    const luminance = Math.round(pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114);
    histogram[luminance]++;
    luminanceSum += luminance;
  }

  // Otsu finds the natural split between ink and the already-cleaned paper.
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestScore = -1;
  let threshold = 172;
  for (let value = 0; value < 256; value++) {
    backgroundWeight += histogram[value];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = pixelCount - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (luminanceSum - backgroundSum) / foregroundWeight;
    const score = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (score > bestScore) {
      bestScore = score;
      threshold = value;
    }
  }
  threshold = Math.max(135, Math.min(205, threshold + Math.round((settings.contrast - 22) * .18)));

  const localDifference = Math.max(14, 22 - settings.contrast * .12);
  for (let y = 0; y < canvas.height; y++) {
    const mapY = Math.min(mapHeight - 1, Math.round(y / Math.max(canvas.height - 1, 1) * (mapHeight - 1)));
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const mapX = Math.min(mapWidth - 1, Math.round(x / Math.max(canvas.width - 1, 1) * (mapWidth - 1)));
      const mi = (mapY * mapWidth + mapX) * 4;
      const luminance = pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114;
      const localBackground = localMap[mi] * .299 + localMap[mi + 1] * .587 + localMap[mi + 2] * .114;
      const chroma = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
      const coloredSurface = chroma >= 30 && luminance >= 42;
      const onWhitePaper = localBackground >= 220 && luminance <= threshold;
      const darkerThanSurface = luminance <= threshold && localBackground - luminance >= localDifference;
      const value = !coloredSurface && (onWhitePaper || darkerThanSurface) ? 0 : 255;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
      pixels[i + 3] = 255;
    }
  }
  ctx.putImageData(source, 0, 0);
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

export async function renderPage(page: ScanPage, maxEdge = 2400): Promise<HTMLCanvasElement> {
  const image = await loadImage(page.url);
  const sourceScale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const source = document.createElement("canvas");
  source.width = Math.max(1, Math.round(image.naturalWidth * sourceScale));
  source.height = Math.max(1, Math.round(image.naturalHeight * sourceScale));
  const sourceCtx = source.getContext("2d", { alpha: false });
  if (!sourceCtx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh.");
  sourceCtx.drawImage(image, 0, 0, source.width, source.height);
  await yieldToBrowser();
  const warped = warpPerspective(source, page.corners, maxEdge);
  const geometryKey = `${page.url}|${page.corners.map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`).join("|")}`;
  const flattened = page.dewarp ? flattenCurvedPage(warped, geometryKey) : warped;
  await yieldToBrowser();
  const straightened = straightenText(flattened, `${geometryKey}|dewarp:${page.dewarp ? 1 : 0}`, page.fineRotation ?? 0);
  const rotated = page.rotation % 180 !== 0;
  const canvas = document.createElement("canvas");
  canvas.width = rotated ? straightened.height : straightened.width;
  canvas.height = rotated ? straightened.width : straightened.height;
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh.");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = canvasFilter(page.settings);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((page.rotation * Math.PI) / 180);
  ctx.drawImage(straightened, -straightened.width / 2, -straightened.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  await yieldToBrowser();
  if (page.settings.filter === "bw") {
    enhanceDocument(canvas, page.settings);
    binaryBlackWhite(canvas, page.settings);
  } else if (page.settings.filter === "grayscale") {
    const deepShadowProfile = enhanceDocument(canvas, page.settings);
    convertToGrayscale(canvas);
    sharpenCanvas(canvas, page.settings.sharpen, deepShadowProfile);
  } else if (page.settings.filter === "enhanced") {
    const deepShadowProfile = enhanceDocument(canvas, page.settings);
    sharpenCanvas(canvas, page.settings.sharpen, deepShadowProfile);
  } else {
    normalizeIllumination(canvas, page.settings.removeShadow);
    sharpenCanvas(canvas, page.settings.sharpen);
  }
  // Canvas backing stores can retain tens of megabytes of RAM/VRAM until a
  // later GC cycle. Release every intermediate surface as soon as the final
  // rendered canvas no longer depends on it.
  for (const temporary of new Set([source, warped, flattened, straightened])) {
    if (temporary !== canvas) {
      temporary.width = 0;
      temporary.height = 0;
    }
  }
  return canvas;
}

