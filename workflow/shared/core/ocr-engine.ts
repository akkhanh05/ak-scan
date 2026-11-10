"use client";
/**
 * Owns the whole lifecycle of Tesseract workers: creation (with a deadline and
 * cancellation, including while the model is downloading), recognition with
 * per-call timeouts, progress stages and guaranteed termination.
 */
import type { RecognizeResult, Worker as TesseractWorker } from "tesseract.js";
import { OCR_ASSET_VERSION, OCR_LANGUAGES } from "./ocr-config";

export type OcrStage = "loading-engine" | "loading-model" | "initializing" | "recognizing";

export interface OcrEngineOptions {
  basePath: string;
  workers?: number;
  onStage?: (stage: OcrStage, progress: number) => void;
  createTimeoutMs?: number;
  recognizeTimeoutMs?: number;
}

export interface RecognizeRequest {
  image: Blob;
  psm: "3" | "4" | "6" | "7" | "11";
  rectangle?: { left: number; top: number; width: number; height: number };
}

export class OcrCancelledError extends Error {
  constructor() { super("Đã hủy nhận diện văn bản."); this.name = "AbortError"; }
}

function stageOf(status: string): OcrStage | null {
  if (/core/i.test(status)) return "loading-engine";
  if (/traineddata|language/i.test(status)) return "loading-model";
  if (/initiali[sz]/i.test(status)) return "initializing";
  if (/recogni/i.test(status)) return "recognizing";
  return null;
}

/** How many OCR workers this device can afford (each holds the model in memory). */
export function recommendedOcrWorkers() {
  if (typeof navigator === "undefined") return 1;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 2;
  return memory !== undefined && memory >= 8 && cores >= 8 ? 2 : 1;
}

export class OcrEngine {
  private readonly options: Required<Omit<OcrEngineOptions, "onStage">> & Pick<OcrEngineOptions, "onStage">;
  private workers: TesseractWorker[] = [];
  private idle: TesseractWorker[] = [];
  private waiting: Array<(worker: TesseractWorker) => void> = [];
  private starting: Promise<void> | null = null;
  private cancelled = false;
  private cancelListeners = new Set<() => void>();

  constructor(options: OcrEngineOptions) {
    this.options = { workers: recommendedOcrWorkers(), createTimeoutMs: 180_000, recognizeTimeoutMs: 120_000, ...options };
  }

  get size() { return this.options.workers; }

  /** Starts the workers; resolves when every worker has loaded the model. */
  start() {
    if (!this.starting) this.starting = this.createWorkers();
    return this.starting;
  }

  private async createWorkers() {
    const { createWorker } = await import("tesseract.js");
    const base = this.options.basePath;
    const create = async () => {
      let created: TesseractWorker | null = null;
      const creation = createWorker(OCR_LANGUAGES, 1, {
        workerPath: `${base}/tesseract-worker.min.js`,
        corePath: `${base}/tesseract-core`,
        langPath: `${base}/tessdata`,
        // Versioned cache key: a model update must not be shadowed by IndexedDB.
        cachePath: `ak-scan-ocr-${OCR_ASSET_VERSION}`,
        gzip: true,
        workerBlobURL: false,
        logger: (message) => {
          if (this.cancelled) return;
          const stage = stageOf(message.status);
          if (stage) this.options.onStage?.(stage, message.progress);
        },
        errorHandler: () => undefined,
      }).then((worker) => { created = worker; return worker; });
      try {
        const worker = await this.guard(creation, this.options.createTimeoutMs, "Không tải được bộ nhận diện chữ. Hãy kiểm tra kết nối mạng rồi thử lại.");
        if (this.cancelled) { await worker.terminate().catch(() => undefined); throw new OcrCancelledError(); }
        return worker;
      } catch (error) {
        // A worker that finishes loading after a timeout/cancel must not linger.
        void creation.then((worker) => worker.terminate()).catch(() => undefined);
        if (created) void (created as TesseractWorker).terminate().catch(() => undefined);
        throw error;
      }
    };
    const results = await Promise.allSettled(Array.from({ length: this.options.workers }, create));
    for (const result of results) if (result.status === "fulfilled") { this.workers.push(result.value); this.idle.push(result.value); }
    const failure = results.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
    if (!this.workers.length) throw failure?.reason ?? new Error("Không khởi tạo được bộ nhận diện chữ.");
  }

  /** Races a promise against the deadline and cancellation. */
  private guard<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    if (this.cancelled) return Promise.reject(new OcrCancelledError());
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(message)); }, timeoutMs);
      const onCancel = () => { cleanup(); reject(new OcrCancelledError()); };
      const cleanup = () => { clearTimeout(timer); this.cancelListeners.delete(onCancel); };
      this.cancelListeners.add(onCancel);
      promise.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    });
  }

  private acquire(): Promise<TesseractWorker> {
    if (this.cancelled) return Promise.reject(new OcrCancelledError());
    const worker = this.idle.pop();
    if (worker) return Promise.resolve(worker);
    return new Promise((resolve, reject) => {
      this.waiting.push(resolve);
      const onCancel = () => reject(new OcrCancelledError());
      this.cancelListeners.add(onCancel);
    });
  }

  private release(worker: TesseractWorker) {
    const next = this.waiting.shift();
    if (next) next(worker); else this.idle.push(worker);
  }

  async recognize(request: RecognizeRequest): Promise<RecognizeResult> {
    await this.start();
    const worker = await this.acquire();
    let healthy = true;
    try {
      await this.guard(worker.setParameters({ tessedit_pageseg_mode: request.psm as never, preserve_interword_spaces: "1", user_defined_dpi: "300" }), 30_000, "Bộ nhận diện chữ không phản hồi.");
      return await this.guard(worker.recognize(request.image, request.rectangle ? { rectangle: request.rectangle } : {}, { text: true, blocks: true }), this.options.recognizeTimeoutMs, "Nhận diện văn bản trang này mất quá nhiều thời gian.");
    } catch (error) {
      healthy = false;
      throw error;
    } finally {
      if (healthy && !this.cancelled) this.release(worker);
      else {
        // A timed-out worker may still be busy: replace it instead of reusing it.
        this.workers = this.workers.filter((item) => item !== worker);
        void worker.terminate().catch(() => undefined);
        if (!this.cancelled && !this.workers.length) this.starting = null;
      }
    }
  }

  /** Stops everything immediately: pending creation, queued and running recognitions. */
  cancel() {
    this.cancelled = true;
    this.cancelListeners.forEach((listener) => listener());
    this.cancelListeners.clear();
    void this.terminate();
  }

  async terminate() {
    const workers = [...this.workers];
    this.workers = []; this.idle = []; this.waiting = [];
    await Promise.all(workers.map((worker) => worker.terminate().catch(() => undefined)));
  }
}
