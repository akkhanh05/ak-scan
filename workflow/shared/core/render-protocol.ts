/** Message types exchanged with the render worker. */
import type { DetectionResult, QualityResult, RenderablePage, TableGrid } from "./scan";

export type RenderOutput =
  | { kind: "bitmap" }
  | { kind: "jpeg"; quality: number }
  | { kind: "png" }
  /** Packed 1-bit rows (1 = white) for black-and-white PDF pages. */
  | { kind: "bilevel" };

export type RenderJob =
  | { id: number; type: "render"; page: RenderablePage; maxEdge: number; maxSourcePixels?: number; output: RenderOutput; detectGrid?: boolean }
  | { id: number; type: "detect"; url: string }
  | { id: number; type: "quality"; url: string; width: number; height: number };

export interface RenderResult {
  width?: number;
  height?: number;
  bitmap?: ImageBitmap;
  bytes?: ArrayBuffer;
  bits?: ArrayBuffer;
  mime?: string;
  grid?: TableGrid | null;
  detection?: DetectionResult;
  quality?: QualityResult;
}

export type RenderReply =
  | { id: number; ok: true; result: RenderResult }
  | { id: number; ok: false; error: string; unsupported?: boolean };
