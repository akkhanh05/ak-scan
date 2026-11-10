"use client";
/**
 * Main-thread client for the render worker. Jobs run one at a time; preview
 * jobs are coalesced so dragging a slider only renders the latest state.
 * When Worker/OffscreenCanvas is unavailable the same pipeline runs on the main
 * thread instead, so every browser still produces identical output.
 */
import type { RenderJob, RenderOutput, RenderReply, RenderResult } from "./render-protocol";
import type { RenderablePage } from "./scan";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type JobInput = DistributiveOmit<RenderJob, "id">;
interface Pending { job: RenderJob; resolve: (result: RenderResult | null) => void; reject: (error: Error) => void; preview: boolean }

export class RenderCancelledError extends Error {
  constructor() { super("Đã hủy xử lý trang."); this.name = "AbortError"; }
}

/** Budget for the decoded source surface; phones with little RAM get less. */
export function sourcePixelBudget() {
  const memory = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  if (memory !== undefined && memory <= 2) return 8_000_000;
  if (memory !== undefined && memory <= 4) return 12_000_000;
  return 24_000_000;
}

export class RenderClient {
  private worker: Worker | null = null;
  private mode: "unknown" | "worker" | "main" = "unknown";
  private queue: Pending[] = [];
  private active: Pending | null = null;
  private nextId = 1;
  private disposed = false;

  render(page: RenderablePage, maxEdge: number, output: RenderOutput, options: { detectGrid?: boolean } = {}): Promise<RenderResult> {
    return this.enqueue({ type: "render", page: plainPage(page), maxEdge, output, detectGrid: options.detectGrid, maxSourcePixels: sourcePixelBudget() }, false) as Promise<RenderResult>;
  }

  /** Resolves with `null` when a newer preview request replaced this one. */
  renderPreview(page: RenderablePage, maxEdge: number): Promise<RenderResult | null> {
    for (const pending of this.queue.filter((item) => item.preview)) pending.resolve(null);
    this.queue = this.queue.filter((item) => !item.preview);
    return this.enqueue({ type: "render", page: plainPage(page), maxEdge, output: { kind: "bitmap" }, maxSourcePixels: sourcePixelBudget() }, true);
  }

  detect(url: string) { return this.enqueue({ type: "detect", url }, false) as Promise<RenderResult>; }
  quality(url: string, width: number, height: number) { return this.enqueue({ type: "quality", url, width, height }, false) as Promise<RenderResult>; }

  /** Rejects queued work and stops the job in progress (the worker is restarted lazily). */
  cancelAll() {
    const cancelled = [...this.queue, ...(this.active ? [this.active] : [])];
    this.queue = [];
    if (this.active && this.worker) { this.worker.terminate(); this.worker = null; if (this.mode === "worker") this.mode = "unknown"; }
    this.active = null;
    cancelled.forEach((item) => item.preview ? item.resolve(null) : item.reject(new RenderCancelledError()));
  }

  dispose() {
    this.disposed = true;
    this.cancelAll();
  }

  private enqueue(input: JobInput, preview: boolean) {
    if (this.disposed) return Promise.reject(new RenderCancelledError());
    return new Promise<RenderResult | null>((resolve, reject) => {
      this.queue.push({ job: { ...input, id: this.nextId++ } as RenderJob, resolve, reject, preview });
      this.pump();
    });
  }

  private pump() {
    if (this.active || !this.queue.length) return;
    // Real work (export/import) goes before previews.
    const index = Math.max(0, this.queue.findIndex((item) => !item.preview));
    const [next] = this.queue.splice(index, 1);
    this.active = next;
    void this.run(next).then(
      (result) => { if (this.active === next) { this.active = null; next.resolve(result); this.pump(); } },
      (error: Error) => { if (this.active === next) { this.active = null; next.reject(error); this.pump(); } },
    );
  }

  private async run(pending: Pending): Promise<RenderResult> {
    if (this.mode !== "main") {
      const worker = this.ensureWorker();
      if (worker) {
        const reply = await new Promise<RenderReply>((resolve) => {
          const onMessage = (event: MessageEvent<RenderReply>) => {
            if (event.data.id !== pending.job.id) return;
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            resolve(event.data);
          };
          const onError = (event: ErrorEvent) => {
            event.preventDefault();
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            resolve({ id: pending.job.id, ok: false, error: event.message || "worker-error", unsupported: true });
          };
          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", onError);
          worker.postMessage(pending.job);
        });
        if (reply.ok) { this.mode = "worker"; return reply.result; }
        if (!reply.unsupported) throw new Error(reply.error);
        // The worker cannot run here (old browser, blocked module workers):
        // fall back to the main thread for this and every later job.
        this.worker?.terminate();
        this.worker = null;
        this.mode = "main";
      } else this.mode = "main";
    }
    return runOnMainThread(pending.job);
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    if (typeof Worker === "undefined") return null;
    try {
      // Bundled by workflow/scripts/sync-runtime-assets.mjs; the version query
      // busts HTTP/service-worker caches whenever the worker code changes.
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      const version = process.env.NEXT_PUBLIC_RENDER_WORKER_VERSION ?? "dev";
      this.worker = new Worker(`${base}/render-worker.js?v=${version}`, { name: "ak-scan-render" });
      return this.worker;
    } catch {
      return null;
    }
  }
}

function plainPage(page: RenderablePage): RenderablePage {
  return {
    url: page.url,
    rotation: page.rotation,
    fineRotation: page.fineRotation,
    dewarp: page.dewarp,
    pdfKind: page.pdfKind,
    corners: page.corners.map((point) => ({ x: point.x, y: point.y })) as RenderablePage["corners"],
    settings: { ...page.settings },
  };
}

async function runOnMainThread(job: RenderJob): Promise<RenderResult> {
  const scan = await import("./scan");
  if (job.type === "detect") return { detection: await scan.detectDocumentCorners(job.url) };
  if (job.type === "quality") return { quality: await scan.analyzeImageQuality(job.url, job.width, job.height) };
  const { encodeSurface } = await import("./render-output");
  const surface = await scan.renderPage(job.page, job.maxEdge, { maxSourcePixels: job.maxSourcePixels });
  try {
    const grid = job.detectGrid ? scan.detectTableGrid(surface) : undefined;
    const { result } = await encodeSurface(surface, job.output);
    return { ...result, grid };
  } finally {
    surface.width = 0; surface.height = 0;
  }
}

let shared: RenderClient | null = null;
/** One render worker per tab. */
export function getRenderClient() {
  if (!shared) shared = new RenderClient();
  return shared;
}
