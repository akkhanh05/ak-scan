"use client";
/**
 * Browser wiring for one export: render worker, OCR engine, optional review,
 * document builders. Every stage reports progress and can be cancelled for real
 * (workers are terminated, not merely ignored).
 */
import type { ExportOptions } from "@/workflow/shared/core/export-options";
import { applyOcrCorrections, buildPageContents, buildPdfPages, exportFileName, hasTextLayer, pagesNeedingOcr, recognizePages } from "@/workflow/shared/core/export-pipeline";
import type { PageOcr, PipelineDeps } from "@/workflow/shared/core/export-pipeline";
import { OcrEngine } from "@/workflow/shared/core/ocr-engine";
import type { OcrStage } from "@/workflow/shared/core/ocr-engine";
import { getRenderClient } from "@/workflow/shared/core/render-client";
import type { Rect } from "@/workflow/shared/core/document-model";
import type { ScanPage } from "@/workflow/shared/core/scan";
import type { ReviewPage } from "./ocr-review-dialog";

export interface ExportProgress { message: string; percent: number }
export interface ExportOutcome { blob: Blob; filename: string; message: string }

export class ExportCancelled extends Error {
  constructor() { super("Đã hủy xuất file."); this.name = "AbortError"; }
}

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const STAGE_MESSAGES: Record<OcrStage, string> = {
  "loading-engine": "Đang tải bộ nhận diện chữ…",
  "loading-model": "Đang tải mô hình tiếng Việt + Anh (chỉ lần đầu, khoảng 4,5 MB)…",
  initializing: "Đang khởi tạo bộ nhận diện chữ…",
  recognizing: "Đang nhận diện chữ…",
};

/** File name from the first source file ("Hợp đồng.pdf" → "Hợp đồng.docx"), safe on every OS. */
export function outputName(pages: ScanPage[], extension: string, suffix = "") {
  const source = pages[0]?.name.replace(/ · trang \d+$/u, "").replace(/\.[a-z0-9]{2,5}$/iu, "") ?? "";
  const cleaned = source.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned ? `${cleaned}${suffix}.${extension}` : exportFileName(`ak-scan${suffix}`, extension);
}

async function cropSource(page: ScanPage, rect: Rect): Promise<Uint8Array | undefined> {
  if (!page.pdfPage || !page.sourceWidth || !page.sourceHeight) return undefined;
  const scaleX = page.sourceWidth / page.pdfPage.width, scaleY = page.sourceHeight / page.pdfPage.height;
  const blob = await (await fetch(page.url)).blob();
  const x = Math.max(0, Math.floor(rect.x0 * scaleX)), y = Math.max(0, Math.floor(rect.y0 * scaleY));
  const width = Math.min(page.sourceWidth - x, Math.ceil((rect.x1 - rect.x0) * scaleX)), height = Math.min(page.sourceHeight - y, Math.ceil((rect.y1 - rect.y0) * scaleY));
  if (width < 2 || height < 2) return undefined;
  const bitmap = await createImageBitmap(blob, x, y, width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  canvas.width = 0; canvas.height = 0;
  return png ? new Uint8Array(await png.arrayBuffer()) : undefined;
}

export class ExportRun {
  private cancelled = false;
  private engine: OcrEngine | null = null;
  private reviewUrls: string[] = [];

  cancel() {
    this.cancelled = true;
    this.engine?.cancel();
    getRenderClient().cancelAll();
  }

  private check = () => { if (this.cancelled) throw new ExportCancelled(); };

  async run(pages: ScanPage[], options: ExportOptions, reportProgress: (progress: ExportProgress) => void, review: (pages: ReviewPage[]) => Promise<Map<string, string[]> | null>): Promise<ExportOutcome> {
    const client = getRenderClient();
    // Workers that are still shutting down must not overwrite the "cancelled" message.
    const onProgress = (progress: ExportProgress) => { if (!this.cancelled) reportProgress(progress); };
    const ocrPages = pagesNeedingOcr(pages, options);
    const weights = ocrPages.length ? { ocr: 70, build: 25 } : { ocr: 0, build: 90 };
    const ocrImages = new Map<string, Blob>();
    const deps: PipelineDeps = {
      render: async (page, maxEdge, output, extra) => {
        const result = await client.render(page, maxEdge, output, extra);
        // Keep the primary OCR image for the review step (line crops).
        if (output.kind === "png" && extra?.detectGrid && result.bytes) ocrImages.set(page.url, new Blob([result.bytes.slice(0)], { type: "image/png" }));
        return result;
      },
      cropSource,
      checkCancelled: this.check,
      progress: ({ stage, done, total, page }) => {
        if (stage === "ocr") onProgress({ message: page ? `Đã nhận diện chữ ${done}/${total} trang…` : `Đang nhận diện chữ ${total} trang…`, percent: Math.round(done / Math.max(1, total) * weights.ocr) });
        else onProgress({ message: stage === "render" ? `Đang dựng trang ${done}/${total}…` : `Đang dựng bố cục trang ${done}/${total}…`, percent: weights.ocr + Math.round(done / Math.max(1, total) * weights.build) });
      },
    };

    let ocr = new Map<string, PageOcr>();
    try {
      if (ocrPages.length) {
        this.engine = new OcrEngine({ basePath, onStage: (stage, progress) => { if (stage !== "recognizing") onProgress({ message: STAGE_MESSAGES[stage], percent: Math.round(progress * 5) }); } });
        deps.recognize = (request) => this.engine!.recognize(request);
        onProgress({ message: STAGE_MESSAGES["loading-engine"], percent: 0 });
        await this.engine.start();
        this.check();
        ocr = await recognizePages(ocrPages, options, deps, this.engine.size);
        this.check();
        if (options.reviewText) {
          const reviewPages = ocrPages.map((page) => {
            const image = ocrImages.get(page.url);
            const imageUrl = image ? URL.createObjectURL(image) : undefined;
            if (imageUrl) this.reviewUrls.push(imageUrl);
            return { pageNumber: pages.indexOf(page) + 1, ocr: ocr.get(page.id)!, imageUrl };
          });
          onProgress({ message: "Đang chờ bạn kiểm tra chữ đã nhận diện…", percent: weights.ocr });
          const corrections = await review(reviewPages);
          if (!corrections) throw new ExportCancelled();
          ocr = new Map([...ocr].map(([id, result]) => [id, applyOcrCorrections(result, corrections.get(id) ?? [])]));
        }
      }

      if (options.format === "docx") {
        const [{ Packer }, { createWordDocument }] = await Promise.all([import("docx"), import("@/workflow/shared/core/export/word")]);
        const contents = await buildPageContents(pages, ocr, deps);
        this.check();
        onProgress({ message: "Đang đóng gói file Word…", percent: 96 });
        const document = createWordDocument(contents, { pageSize: options.pageSize, margin: options.margin, mode: options.wordMode, title: outputName(pages, "docx").replace(/\.docx$/, "") });
        const blob = await Packer.toBlob(document);
        const textLayer = pages.filter(hasTextLayer).length;
        return {
          blob,
          filename: outputName(pages, "docx"),
          message: `Đã tạo file Word ${pages.length} trang${textLayer ? ` · ${textLayer} trang dựng từ lớp chữ PDF` : ""}${ocrPages.length ? ` · ${ocrPages.length} trang nhận diện chữ` : ""}.`,
        };
      }

      const { buildPdfDocument } = await import("@/workflow/shared/core/export/pdf");
      const inputs = await buildPdfPages(pages, options.searchable ? ocr : null, options, deps);
      this.check();
      onProgress({ message: "Đang đóng gói file PDF…", percent: 96 });
      let font: Uint8Array | undefined, fontkit: unknown;
      if (options.searchable) {
        const [response, kit] = await Promise.all([fetch(`${basePath}/NotoSans-Regular.ttf`), import("@pdf-lib/fontkit")]);
        if (!response.ok) throw new Error("Không thể tải font Unicode cho lớp chữ PDF.");
        font = new Uint8Array(await response.arrayBuffer());
        fontkit = kit.default;
      }
      const bytes = await buildPdfDocument(inputs, { pageSize: options.pageSize, margin: options.margin, font, fontkit, title: outputName(pages, "pdf").replace(/\.pdf$/, "") });
      return {
        blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }),
        filename: outputName(pages, "pdf", options.searchable ? " (tìm kiếm được)" : ""),
        message: options.searchable ? "Đã tạo PDF có thể tìm kiếm · chữ được nhận diện ngay trên thiết bị." : "Đã tạo PDF. Ảnh vẫn chỉ nằm trên thiết bị này.",
      };
    } finally {
      await this.engine?.terminate();
      this.engine = null;
      this.reviewUrls.forEach((url) => URL.revokeObjectURL(url));
      this.reviewUrls = [];
    }
  }
}

export function readableExportError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "Đã hủy xuất file. Bạn có thể tiếp tục chỉnh sửa.";
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return detail.trim() ? `Không thể tạo file: ${detail.trim()}` : "Không thể tạo file. Hãy thử chọn chất lượng Gọn rồi tạo lại.";
}

export function downloadBlob(blob: Blob, filename: string) {
  if (!blob.size) throw new Error("File tạo ra bị trống. Hãy thử lại.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
