/**
 * Geometry shared by rendering and export: the same corner crop, fine rotation
 * and quarter-turn rotation that the canvas pipeline applies to pixels can be
 * applied to points, so text from a PDF text layer lands on the right pixels.
 */

export type Point = { x: number; y: number };
export type Corners = [Point, Point, Point, Point];

export const defaultCorners: Corners = [
  { x: 0.005, y: 0.005 }, { x: 0.995, y: 0.005 },
  { x: 0.995, y: 0.995 }, { x: 0.005, y: 0.995 },
];

export function isDefaultCrop(corners: Corners) {
  return corners.every((point, index) => Math.abs(point.x - defaultCorners[index].x) < 1e-3 && Math.abs(point.y - defaultCorners[index].y) < 1e-3);
}

type Matrix3 = [number, number, number, number, number, number, number, number, number];

/** Homography mapping the unit square (u, v) onto the quad (normalised source coordinates). */
export function quadHomography(corners: Corners): Matrix3 {
  const [p0, p1, p2, p3] = corners;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(denominator) < 1e-8 ? 0 : (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = Math.abs(denominator) < 1e-8 ? 0 : (dx1 * dy3 - dx3 * dy1) / denominator;
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y;
  return [a, b, p0.x, d, e, p0.y, g, h, 1];
}

export function projectUnitToQuad(corners: Corners, u: number, v: number): Point {
  const m = quadHomography(corners);
  const w = m[6] * u + m[7] * v + m[8];
  return { x: (m[0] * u + m[1] * v + m[2]) / w, y: (m[3] * u + m[4] * v + m[5]) / w };
}

function invert(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error("Bốn góc tạo thành hình suy biến.");
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/** Inverse of `projectUnitToQuad`: normalised source point → (u, v) in the crop. */
export function unprojectQuadToUnit(corners: Corners, point: Point): Point {
  const m = invert(quadHomography(corners));
  const w = m[6] * point.x + m[7] * point.y + m[8];
  return { x: (m[0] * point.x + m[1] * point.y + m[2]) / w, y: (m[3] * point.x + m[4] * point.y + m[5]) / w };
}

export interface RenderGeometry {
  corners: Corners;
  /** Quarter turns in degrees: 0, 90, 180 or 270. */
  rotation: number;
  /** Total small rotation applied by straightening, in degrees (clockwise on screen). */
  fineRotation: number;
}

/**
 * Maps a normalised point of the source image to a pixel of the rendered page
 * (crop → straighten → quarter turn). `output` is the rendered canvas size.
 */
export function mapSourceToRendered(point: Point, geometry: RenderGeometry, output: { width: number; height: number }): Point {
  const quarter = ((geometry.rotation % 360) + 360) % 360;
  const swapped = quarter % 180 !== 0;
  const warpedWidth = swapped ? output.height : output.width;
  const warpedHeight = swapped ? output.width : output.height;
  const unit = unprojectQuadToUnit(geometry.corners, point);
  let x = unit.x * warpedWidth, y = unit.y * warpedHeight;

  if (geometry.fineRotation) {
    const radians = geometry.fineRotation * Math.PI / 180;
    const sine = Math.abs(Math.sin(radians)), cosine = Math.abs(Math.cos(radians));
    const fit = Math.min(1, warpedWidth / (warpedWidth * cosine + warpedHeight * sine), warpedHeight / (warpedWidth * sine + warpedHeight * cosine));
    const dx = (x - warpedWidth / 2) * fit, dy = (y - warpedHeight / 2) * fit;
    x = warpedWidth / 2 + dx * Math.cos(radians) - dy * Math.sin(radians);
    y = warpedHeight / 2 + dx * Math.sin(radians) + dy * Math.cos(radians);
  }
  if (quarter) {
    const radians = quarter * Math.PI / 180;
    const dx = x - warpedWidth / 2, dy = y - warpedHeight / 2;
    x = output.width / 2 + dx * Math.cos(radians) - dy * Math.sin(radians);
    y = output.height / 2 + dx * Math.sin(radians) + dy * Math.cos(radians);
  }
  return { x, y };
}

export function insidePolygon(point: Point, polygon: Point[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
