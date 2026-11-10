/**
 * Unit Test Script for Scan Core Logic (`lib/scan.ts`)
 * Run with: npx tsx workflow/scripts/test-scan-logic.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- Canvas/DOM test doubles intentionally implement only the loose browser surface used by scan.ts. */

import {
  defaultCorners,
  defaultSettings,
  blurRgba,
  percentile,
  intersectLines,
  distance,
  projectUnitToQuad,
  scoreDocumentBoundary,
  correctShadowChannel,
  protectInkFromShadowRemoval,
  shouldPreserveDocumentColor,
  isDarkInkOnColoredSurface,
  sharpenChannel,
  ocrPreprocessFilters,
  restoreColoredSurfaceChannel,
  estimateDocumentShadowSeverity,
  detectTableGrid,
  ScanSettings,
  Corners,
  DetectedLine,
} from "../shared/core/scan";
import { mapSourceToRendered, unprojectQuadToUnit } from "../shared/core/page-geometry";

// Mock Canvas & DOM Environment for Node environment if needed
class MockCanvasRenderingContext2D {
  canvas: MockCanvas;

  constructor(canvas: MockCanvas) {
    this.canvas = canvas;
  }

  getImageData(x: number, y: number, w: number, h: number) {
    return { data: this.canvas.pixels };
  }

  drawImage() {}
  putImageData(imgData: { data: Uint8ClampedArray }) {
    if (imgData && imgData.data) {
      this.canvas.pixels.set(imgData.data);
    }
  }
  fillRect() {}
  save() {}
  restore() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  clip() {}
  setTransform() {}
  rotate() {}
  scale() {}
  translate() {}
}

class MockCanvas {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  ctx: MockCanvasRenderingContext2D;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    // RGBA pixels initialized to white (255, 255, 255, 255)
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.pixels.fill(255);
    this.ctx = new MockCanvasRenderingContext2D(this);
  }

  getContext(type: string, options?: any) {
    if (type === "2d") return this.ctx;
    return null;
  }
}

// Global DOM mock fallback
if (typeof globalThis.document === "undefined") {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === "canvas") return new MockCanvas(300, 150);
      return {};
    },
  };
}

if (typeof globalThis.HTMLCanvasElement === "undefined") {
  (globalThis as any).HTMLCanvasElement = MockCanvas;
}

// Test Runner Infrastructure
let passedTests = 0;
let failedTests = 0;
const testResults: { name: string; status: "PASS" | "FAIL"; message?: string }[] = [];

function runTest(name: string, fn: () => void) {
  try {
    fn();
    passedTests++;
    testResults.push({ name, status: "PASS" });
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    failedTests++;
    testResults.push({ name, status: "FAIL", message: err.message });
    console.error(`  [FAIL] ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertEquals<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg} | Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`);
  }
}

function assertCloseTo(actual: number, expected: number, delta = 1e-4, msg = "") {
  if (Math.abs(actual - expected) > delta) {
    throw new Error(`${msg} | Expected ~${expected} (±${delta}), Actual: ${actual}`);
  }
}

console.log("=================================================");
console.log(" SCAN CORE LOGIC UNIT TEST SUITE ");
console.log("=================================================\n");

// ----------------------------------------------------
// 1. Default Configurations Test Suite
// ----------------------------------------------------
console.log("Suite 1: Default Configurations (defaultCorners, defaultSettings)");

runTest("defaultCorners has correct structure and normalized values [0, 1]", () => {
  assert(Array.isArray(defaultCorners), "defaultCorners should be an array");
  assertEquals(defaultCorners.length, 4, "defaultCorners must have 4 points");

  const [tl, tr, br, bl] = defaultCorners;
  // Top-Left
  assertEquals(tl.x, 0.005, "Top-Left X");
  assertEquals(tl.y, 0.005, "Top-Left Y");
  // Top-Right
  assertEquals(tr.x, 0.995, "Top-Right X");
  assertEquals(tr.y, 0.005, "Top-Right Y");
  // Bottom-Right
  assertEquals(br.x, 0.995, "Bottom-Right X");
  assertEquals(br.y, 0.995, "Bottom-Right Y");
  // Bottom-Left
  assertEquals(bl.x, 0.005, "Bottom-Left X");
  assertEquals(bl.y, 0.995, "Bottom-Left Y");

  // Bounds assertion
  for (const pt of defaultCorners) {
    assert(pt.x >= 0 && pt.x <= 1, `Point X ${pt.x} out of bounds`);
    assert(pt.y >= 0 && pt.y <= 1, `Point Y ${pt.y} out of bounds`);
  }
});

runTest("defaultSettings has correct initial defaults", () => {
  assertEquals(defaultSettings.filter, "original", "Default filter must be 'original'");
  assertEquals(defaultSettings.brightness, 0, "Default brightness must be 0");
  assertEquals(defaultSettings.contrast, 0, "Default contrast must be 0");
  assertEquals(defaultSettings.whiten, 0, "Default whiten must be 0");
  assertEquals(defaultSettings.sharpen, 0, "Default sharpen must be 0");
  assertEquals(defaultSettings.removeShadow, 0, "Default removeShadow must be 0");
});

// ----------------------------------------------------
// 2. Worker-safe blur and page geometry
// ----------------------------------------------------
console.log("\nSuite 2: Worker-safe blur (replaces ctx.filter) and page geometry");

runTest("blurRgba keeps a uniform paper colour unchanged", () => {
  const pixels = new Uint8ClampedArray(12 * 8 * 4).fill(200);
  blurRgba(pixels, 12, 8, 4);
  assert(pixels.every((value, index) => index % 4 === 3 || value === 200), "uniform image must stay uniform");
});

runTest("blurRgba spreads a dark glyph so the background map no longer contains it", () => {
  const width = 21, height = 21;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const center = (10 * width + 10) * 4;
  pixels[center] = pixels[center + 1] = pixels[center + 2] = 0;
  blurRgba(pixels, width, height, 4);
  assert(pixels[center] > 200, `isolated ink must be mostly removed, got ${pixels[center]}`);
});

runTest("unprojectQuadToUnit inverts projectUnitToQuad for a perspective crop", () => {
  const corners: Corners = [{ x: .1, y: .05 }, { x: .92, y: .12 }, { x: .85, y: .95 }, { x: .05, y: .88 }];
  for (const [u, v] of [[0, 0], [1, 0], [.3, .7], [.5, .5], [1, 1]]) {
    const point = projectUnitToQuad(corners, u, v);
    const back = unprojectQuadToUnit(corners, point);
    assert(Math.abs(back.x - u) < 1e-9 && Math.abs(back.y - v) < 1e-9, `round trip failed for ${u},${v}`);
  }
});

runTest("mapSourceToRendered follows a quarter turn exactly like renderPage", () => {
  const corners: Corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  // Source 200x100 rotated 90° clockwise renders as 100x200: top-left goes to top-right.
  const mapped = mapSourceToRendered({ x: 0, y: 0 }, { corners, rotation: 90, fineRotation: 0 }, { width: 100, height: 200 });
  assert(Math.abs(mapped.x - 100) < 1e-9 && Math.abs(mapped.y - 0) < 1e-9, `got ${mapped.x},${mapped.y}`);
});

// ----------------------------------------------------
// 3. Math & Geometry Helper Functions Test Suite
// ----------------------------------------------------
console.log("\nSuite 3: Math & Geometry Helper Functions");

runTest("percentile function correctly computes quantile values", () => {
  const values = [10, 20, 30, 40, 50];

  assertEquals(percentile(values, 0.0), 10, "Percentile 0.0 should be min element");
  assertEquals(percentile(values, 0.5), 30, "Percentile 0.5 should be median element");
  assertEquals(percentile(values, 0.99), 50, "Percentile 0.99 should be max element");

  // Unsorted array handling
  const unsorted = [50, 10, 40, 20, 30];
  assertEquals(percentile(unsorted, 0.5), 30, "Percentile should handle unsorted array");

  // Empty array handling
  assertEquals(percentile([], 0.5), 0, "Empty array should return 0 fallback");
});

runTest("intersectLines correctly calculates line intersection point", () => {
  // Perpendicular lines: X = 50 (1*x + 0*y = 50) and Y = 30 (0*x + 1*y = 30)
  const line1: DetectedLine = { a: 1, b: 0, c: 50, score: 100 };
  const line2: DetectedLine = { a: 0, b: 1, c: 30, score: 100 };

  const intersection = intersectLines(line1, line2);
  assert(intersection !== null, "Perpendicular lines should intersect");
  assertCloseTo(intersection!.x, 50, 1e-4, "Intersection X");
  assertCloseTo(intersection!.y, 30, 1e-4, "Intersection Y");

  // Diagonal intersecting lines: x + y = 10 (1*x + 1*y = 10) and x - y = 0 (1*x - 1*y = 0)
  const line3: DetectedLine = { a: 1, b: 1, c: 10, score: 100 };
  const line4: DetectedLine = { a: 1, b: -1, c: 0, score: 100 };
  const diagIntersection = intersectLines(line3, line4);
  assert(diagIntersection !== null, "Diagonal lines should intersect");
  assertCloseTo(diagIntersection!.x, 5, 1e-4, "Diagonal Intersection X");
  assertCloseTo(diagIntersection!.y, 5, 1e-4, "Diagonal Intersection Y");
});

runTest("intersectLines returns null for parallel or near-parallel lines", () => {
  // Parallel lines: 1*x + 0*y = 10 and 1*x + 0*y = 20
  const line1: DetectedLine = { a: 1, b: 0, c: 10, score: 100 };
  const line2: DetectedLine = { a: 1, b: 0, c: 20, score: 100 };

  const intersection = intersectLines(line1, line2);
  assertEquals(intersection, null, "Parallel lines should return null");

  // Near-parallel lines with determinant < 0.08
  const line3: DetectedLine = { a: 1, b: 0.01, c: 10, score: 100 };
  const line4: DetectedLine = { a: 1, b: 0.02, c: 20, score: 100 };
  // determinant = 1*0.02 - 1*0.01 = 0.01 < 0.08
  const nearParallel = intersectLines(line3, line4);
  assertEquals(nearParallel, null, "Near-parallel lines with det < 0.08 should return null");
});

runTest("distance function calculates scaled Euclidean distance", () => {
  const p1 = { x: 0.1, y: 0.2 };
  const p2 = { x: 0.4, y: 0.6 };

  // Scaled dx = (0.4 - 0.1) * 1000 = 300
  // Scaled dy = (0.6 - 0.2) * 1000 = 400
  // Distance = sqrt(300^2 + 400^2) = 500
  const dist = distance(p1, p2, 1000, 1000);
  assertCloseTo(dist, 500, 1e-4, "3-4-5 triangle scaled distance");
});

runTest("document boundary scoring rejects a strong outer frame in favour of an inset paper edge", () => {
  const outerTableFrame = scoreDocumentBoundary(150, 0.02, 170, 170);
  const insetPaperEdge = scoreDocumentBoundary(100, 0.16, 225, 185);
  assert(insetPaperEdge > outerTableFrame, "Inset bright paper edge should outrank a stronger frame near the image border");

  const closeCroppedPaper = scoreDocumentBoundary(100, 0.025, 235, 150);
  assert(closeCroppedPaper > outerTableFrame, "A real high-contrast paper edge may still be selected near the image border");
});

runTest("deep-shadow correction lifts camera shadows while preserving ink contrast", () => {
  const shadowPaper = correctShadowChannel(38, 52, 1);
  const shadowInk = correctShadowChannel(8, 52, 1);
  const mediumShadow = correctShadowChannel(82, 150, 1);
  const normalPaper = correctShadowChannel(225, 225, 1);
  assert(shadowPaper > 200, "Deep shadow background should be lifted close to paper white");
  assert(shadowPaper - shadowInk >= 25, "Ink contrast inside a deep shadow should be preserved");
  assert(mediumShadow > 145, "A medium narrow shadow should be lifted before it becomes a black patch");
  assert(normalPaper >= 235 && normalPaper <= 250, "Normally lit paper should not be overexposed excessively");
});

runTest("shadow removal protects sharp black ink but keeps correcting smooth shadows", () => {
  const inkStrength = protectInkFromShadowRemoval(1, 24, 220);
  const smoothShadowStrength = protectInkFromShadowRemoval(1, 48, 58);
  assert(inkStrength < .15, "Sharp black text should receive very little shadow lifting");
  assert(smoothShadowStrength > .9, "A smooth dark patch should keep the full shadow correction");
});

runTest("colour preservation keeps intentional document colours but rejects pale edge casts", () => {
  assert(shouldPreserveDocumentColor(30, 135, 225), "A saturated blue table cell should retain its colour");
  assert(shouldPreserveDocumentColor(215, 35, 45), "A red stamp should retain its colour");
  assert(!shouldPreserveDocumentColor(210, 230, 240), "A pale cyan cast on white paper should be neutralized");
  assert(!shouldPreserveDocumentColor(245, 232, 210), "A pale warm cast on white paper should be neutralized");
});

runTest("dark text on a coloured table cell is protected from white pinholes", () => {
  assert(isDarkInkOnColoredSurface(28, 30, 32, 25, 118, 190), "Black table-header text should be detected as ink over blue");
  assert(!isDarkInkOnColoredSurface(25, 118, 190, 25, 118, 190), "The blue cell itself is not ink");
  assert(!isDarkInkOnColoredSurface(28, 30, 32, 235, 238, 240), "Black text on neutral paper should use the normal enhancer");
});

runTest("document sharpening darkens ink without creating a white halo", () => {
  assertEquals(sharpenChannel(80, 20, .2, true), 68, "A dark stroke may be made darker");
  assertEquals(sharpenChannel(180, 300, .2, true), 180, "Bright overshoot around a stroke must be suppressed");
  assertEquals(sharpenChannel(180, 300, .2, false), 204, "Original-photo sharpening may retain symmetric detail enhancement");
});

runTest("OCR preprocessing retries weak scans with adaptive binary", () => {
  assertEquals(ocrPreprocessFilters(97).join(","), "grayscale", "clean scan profile");
  assertEquals(ocrPreprocessFilters(93).join(","), "grayscale,enhanced", "medium scan profile");
  assertEquals(ocrPreprocessFilters(72).join(","), "grayscale,enhanced,bw", "weak scan profile");
});

runTest("neutral edge halos are reconstructed from the coloured surface hue", () => {
  const red = restoreColoredSurfaceChannel(25, 105, 12);
  const green = restoreColoredSurfaceChannel(105, 105, 12);
  const blue = restoreColoredSurfaceChannel(185, 105, 12);
  assert(blue > green && green > red, "Reconstructed pixels should retain the blue surface hue");
  assert(blue < 255, "Surface reconstruction must not create a clipped white/cyan rim");
});

runTest("shadow profiling keeps clean scans on the classic enhancer and detects phone shadows", () => {
  const clean = new Uint8ClampedArray(100 * 4);
  const shadowed = new Uint8ClampedArray(100 * 4);
  for (let pixel = 0; pixel < 100; pixel++) {
    const cleanTone = pixel < 8 ? 205 : 242;
    const shadowTone = pixel < 22 ? 92 : 232;
    for (let channel = 0; channel < 3; channel++) {
      clean[pixel * 4 + channel] = cleanTone;
      shadowed[pixel * 4 + channel] = shadowTone;
    }
    clean[pixel * 4 + 3] = shadowed[pixel * 4 + 3] = 255;
  }
  assert(estimateDocumentShadowSeverity(clean) < .68, "A clean scan should retain the classic enhancement profile");
  assert(estimateDocumentShadowSeverity(shadowed) >= .68, "A broad phone shadow should enable deep-shadow correction");
});

runTest("projectUnitToQuad maps unit coordinates (u, v) to quadrilateral points", () => {
  const corners: Corners = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ];

  // Test corners mapping
  const p00 = projectUnitToQuad(corners, 0, 0);
  assertCloseTo(p00.x, 0, 1e-4, "p(0,0).x");
  assertCloseTo(p00.y, 0, 1e-4, "p(0,0).y");

  const p10 = projectUnitToQuad(corners, 1, 0);
  assertCloseTo(p10.x, 100, 1e-4, "p(1,0).x");
  assertCloseTo(p10.y, 0, 1e-4, "p(1,0).y");

  const p11 = projectUnitToQuad(corners, 1, 1);
  assertCloseTo(p11.x, 100, 1e-4, "p(1,1).x");
  assertCloseTo(p11.y, 50, 1e-4, "p(1,1).y");

  const p01 = projectUnitToQuad(corners, 0, 1);
  assertCloseTo(p01.x, 0, 1e-4, "p(0,1).x");
  assertCloseTo(p01.y, 50, 1e-4, "p(0,1).y");

  // Test center mapping (0.5, 0.5)
  const pCenter = projectUnitToQuad(corners, 0.5, 0.5);
  assertCloseTo(pCenter.x, 50, 1e-4, "p(0.5,0.5).x");
  assertCloseTo(pCenter.y, 25, 1e-4, "p(0.5,0.5).y");
});

// ----------------------------------------------------
// 4. Canvas & Table Grid Detection Test Suite
// ----------------------------------------------------
console.log("\nSuite 4: Canvas & Table Grid Detection (detectTableGrid)");

runTest("detectTableGrid returns null for a blank white canvas", () => {
  const canvas = new MockCanvas(400, 400) as unknown as HTMLCanvasElement;
  const grid = detectTableGrid(canvas);
  assertEquals(grid, null, "Blank canvas should not detect any table grid");
});

runTest("detectTableGrid identifies grid lines on a synthetic table canvas", () => {
  const width = 400;
  const height = 400;
  const mockCanvas = new MockCanvas(width, height);

  // Helper to draw dark pixel (luminance < 120, e.g. RGB=0,0,0)
  const drawDarkHorizontalLine = (y: number) => {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      mockCanvas.pixels[idx] = 0;
      mockCanvas.pixels[idx + 1] = 0;
      mockCanvas.pixels[idx + 2] = 0;
      mockCanvas.pixels[idx + 3] = 255;
    }
  };

  const drawDarkVerticalLine = (x: number, yStart: number, yEnd: number) => {
    for (let y = yStart; y <= yEnd; y++) {
      const idx = (y * width + x) * 4;
      mockCanvas.pixels[idx] = 0;
      mockCanvas.pixels[idx + 1] = 0;
      mockCanvas.pixels[idx + 2] = 0;
      mockCanvas.pixels[idx + 3] = 255;
    }
  };

  // Draw 3 horizontal lines across table area (e.g. y = 50, y = 150, y = 250)
  drawDarkHorizontalLine(50);
  drawDarkHorizontalLine(150);
  drawDarkHorizontalLine(250);

  // Draw 3 vertical lines between y = 50 and y = 250 (e.g. x = 50, x = 180, x = 320)
  drawDarkVerticalLine(50, 50, 250);
  drawDarkVerticalLine(180, 50, 250);
  drawDarkVerticalLine(320, 50, 250);

  const canvas = mockCanvas as unknown as HTMLCanvasElement;
  const grid = detectTableGrid(canvas);

  assert(grid !== null, "Grid should be detected on synthetic table canvas");
  assert(grid!.yLines.length >= 2, "yLines should detect horizontal grid boundaries");
  assert(grid!.xLines.length >= 2, "xLines should detect vertical grid boundaries");

  // Verify Y boundaries include y = 50 and y = 250
  assert(grid!.yLines.includes(50), "yLines should include top boundary line y=50");
  assert(grid!.yLines.includes(250), "yLines should include bottom boundary line y=250");

  // Verify X boundaries include x = 50 and x = 320
  assert(grid!.xLines.includes(50), "xLines should include left boundary line x=50");
  assert(grid!.xLines.includes(320), "xLines should include right boundary line x=320");
});

// ----------------------------------------------------
// Test Execution Summary
// ----------------------------------------------------
console.log("\n=================================================");
console.log(` TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log("=================================================");

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}


