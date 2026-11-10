/// <reference lib="webworker" />
/**
 * Dedicated worker that runs the pixel pipeline off the main thread with
 * OffscreenCanvas. Messages are processed one at a time; results are
 * transferred (ImageBitmap/ArrayBuffer) rather than copied.
 */
import { analyzeImageQuality, detectDocumentCorners, detectTableGrid, renderPage } from "./scan";
import type { RenderJob, RenderReply } from "./render-protocol";
import { encodeSurface } from "./render-output";

const scope = self as unknown as DedicatedWorkerGlobalScope;

function supported() {
  try {
    return typeof OffscreenCanvas !== "undefined" && Boolean(new OffscreenCanvas(1, 1).getContext("2d")) && typeof createImageBitmap === "function";
  } catch {
    return false;
  }
}

scope.onmessage = async (event: MessageEvent<RenderJob>) => {
  const job = event.data;
  const reply = (message: RenderReply, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
  if (!supported()) { reply({ id: job.id, ok: false, error: "unsupported", unsupported: true }); return; }
  try {
    if (job.type === "render") {
      const surface = await renderPage(job.page, job.maxEdge, { maxSourcePixels: job.maxSourcePixels });
      const grid = job.detectGrid ? detectTableGrid(surface) : undefined;
      const output = await encodeSurface(surface, job.output);
      surface.width = 0; surface.height = 0;
      reply({ id: job.id, ok: true, result: { ...output.result, grid } }, output.transfer);
    } else if (job.type === "detect") {
      reply({ id: job.id, ok: true, result: { detection: await detectDocumentCorners(job.url) } });
    } else if (job.type === "quality") {
      reply({ id: job.id, ok: true, result: { quality: await analyzeImageQuality(job.url, job.width, job.height) } });
    }
  } catch (error) {
    reply({ id: job.id, ok: false, error: error instanceof Error ? error.message : "Không thể xử lý trang." });
  }
};

