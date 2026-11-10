"use client";

import { useEffect, useRef, useState } from "react";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AlertTriangle, Crop, Download, Eye, FileText, ImagePlus, LoaderCircle, RotateCw, ScanLine, ScanSearch, SlidersHorizontal } from "lucide-react";
import { jsPDF } from "jspdf";
import { analyzeImageQuality, defaultCorners, defaultSettings, detectDocumentCorners, FilterName, ocrPreprocessFilters, renderPage, ScanPage } from "@/workflow/shared/core";
import { ScanPreview } from "./scan-preview";
import { ExportDialog, ExportOptions } from "./export-dialog";
import { HomeGuide } from "./home-guide";
import { DonateWidget } from "./donate-widget";
import { AppFooter } from "./app-footer";
import { AppHeader } from "./app-header";
import { HomeUpload } from "./home-upload";
import { SortablePage } from "./sortable-page";
import { ExportGuide } from "./export-guide";
import { PageToc } from "./page-toc";
import { detectUploadKind, safeDisplayName, sanitizeDocumentText, withTimeout, withOcrTimeout, PdfTextItem, TerminableOcrWorker, recognizedTextLines, analyzePageLayout, tokensFromPdfTextItems, postProcessOcrLine, repairFragmentedOcrWords, scoreOcrCandidate, cleanOcrPageLines, mergeDocumentParagraphs, isSuspiciousOcrLine, selectBestOcrLines, deduplicateOcrLines, structureOcrDocumentLines } from "@/workflow/shared/core";
import type { PSM } from "tesseract.js";
import { ImportSessionController } from "@/workflow/shared/core/import-session";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_PDF_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 24_000_000;
const MAX_SESSION_PIXELS = 160_000_000;
const OCR_RECOGNITION_TIMEOUT = 90_000;

function selectedOcrLanguages() {
  return "eng+vie";
}

function selectedPageSegmentation(options: ExportOptions) {
  return (options.ocrLayout === "multi-column" ? "3" : options.ocrLayout === "sparse" ? "11" : "4") as PSM;
}

const ocrAssetBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const localOcrAssets = {
  workerPath: `${ocrAssetBasePath}/tesseract-worker.min.js`,
  corePath: `${ocrAssetBasePath}/tesseract-core`,
  langPath: `${ocrAssetBasePath}/tessdata`,
  gzip: false,
};

function releaseCanvas(...canvases: Array<HTMLCanvasElement | null | undefined>) {
  for (const canvas of new Set(canvases.filter(Boolean))) {
    canvas!.width = 0;
    canvas!.height = 0;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  if (!blob.size) throw new Error("File PDF tạo ra bị trống. Hãy thử giảm chất lượng rồi tạo lại.");
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

async function canvasToDataUrl(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality?: number) {
  try {
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Trình duyệt không thể mã hóa ảnh trang.")), type, quality));
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Trình duyệt không thể đọc ảnh trang để tạo PDF."));
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Không thể chuyển ảnh trang sang dữ liệu PDF."));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    throw new Error(`Không thể mã hóa trang scan thành PDF: ${error instanceof Error ? error.message : "NetworkError"}`);
  }
}

function readableExportError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "Đã hủy xuất file. Bạn có thể tiếp tục chỉnh sửa.";
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return detail.trim() ? `Không thể tạo file: ${detail.trim()}` : "Không thể tạo file. Hãy thử chọn chất lượng Gọn rồi tạo lại.";
}

const filters: Array<{ id: FilterName; label: string }> = [
  { id: "original", label: "Ảnh gốc" }, { id: "enhanced", label: "Tăng cường" },
  { id: "grayscale", label: "Xám" }, { id: "bw", label: "Trắng đen" }
];

export function ScanWorkspace() {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [editingCorners, setEditingCorners] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({ pageSize: "a4", margin: "small", quality: "balanced", searchable: false, format: "pdf", ocrLayout: "auto", wordMode: "editable" });
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef(new Set<string>());
  const importSession = useRef(new ImportSessionController());
  const cancelExport = useRef(false);
  const activeOcrWorkers = useRef(new Set<TerminableOcrWorker>());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const active = pages.find((page) => page.id === activeId) ?? pages[0];

  function stopActiveOcrWorkers() {
    activeOcrWorkers.current.forEach((worker) => { void Promise.resolve(worker.terminate()).catch(() => undefined); });
    activeOcrWorkers.current.clear();
  }

  function cancelCurrentExport() {
    cancelExport.current = true;
    stopActiveOcrWorkers();
  }

  async function recognizeWithTimeout<T>(worker: TerminableOcrWorker, recognition: Promise<T>, pageNumber: number) {
    if (cancelExport.current) throw new DOMException("Đã hủy xuất", "AbortError");
    const result = await withOcrTimeout(worker, recognition, OCR_RECOGNITION_TIMEOUT, `Nhận diện văn bản trang ${pageNumber} mất quá nhiều thời gian.`);
    if (cancelExport.current) throw new DOMException("Đã hủy xuất", "AbortError");
    return result;
  }

  useEffect(() => () => {
    importSession.current.cancel();
    cancelExport.current = true;
    stopActiveOcrWorkers();
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
  }, []);

  async function inspectFile(file: File) {
    const name = safeDisplayName(file.name);
    const kind = await detectUploadKind(file);
    if (!kind || kind === "pdf") throw new Error(`${name}: nội dung file không phải ảnh JPG, PNG hoặc WebP hợp lệ.`);
    if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error(`${name}: ảnh phải nhỏ hơn 15 MB.`);
    const url = URL.createObjectURL(file);
    try {
      const dimensions = await withTimeout(new Promise<{ width: number; height: number }>((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error(`${name}: file ảnh bị hỏng.`)); image.src = url; }), 15_000, `${name}: đọc ảnh quá thời gian cho phép.`);
      if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) throw new Error(`${name}: ảnh vượt giới hạn 24 megapixel.`);
      objectUrls.current.add(url); return { url, ...dimensions };
    } catch (error) { URL.revokeObjectURL(url); throw error; }
  }

  async function inspectPdf(file: File, limit: number) {
    const name = safeDisplayName(file.name);
    if (await detectUploadKind(file) !== "pdf") throw new Error(`${name}: nội dung file không phải PDF hợp lệ.`);
    if (!file.size || file.size > MAX_PDF_BYTES) throw new Error(`${name}: PDF phải nhỏ hơn 40 MB.`);
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = `${ocrAssetBasePath}/pdf.worker.min.mjs`;
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await withTimeout(loadingTask.promise, 30_000, `${name}: PDF mất quá nhiều thời gian để mở.`).catch(async (error) => { await loadingTask.destroy(); throw error; });
    const results: Array<{ url: string; width: number; height: number; name: string; embeddedText?: string; embeddedTextItems?: PdfTextItem[]; pdfKind?: "document" | "scan" }> = [];
    try { for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, limit); pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.4, 2200 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error(`${file.name}: không thể dựng trang ${pageNumber}.`);
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await withTimeout(page.render({ canvas, canvasContext: context, viewport }).promise, 30_000, `${name}: trang ${pageNumber} mất quá nhiều thời gian để dựng.`);
      const textContent = await page.getTextContent();
      const embeddedText = sanitizeDocumentText(textContent.items.map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("")).trim();
      const embeddedTextItems: PdfTextItem[] = textContent.items.flatMap((item) => "str" in item && item.str.trim() ? [{ text: sanitizeDocumentText(item.str), x: item.transform[4], y: item.transform[5], width: item.width, height: item.height, fontName: item.fontName, hasEol: item.hasEOL }] : []);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không thể tạo ảnh trang PDF.")), "image/jpeg", .95));
      const url = URL.createObjectURL(blob);
      objectUrls.current.add(url);
      const hasTextLayer = embeddedText.length >= 12 && embeddedTextItems.length > 0;
      // Score the text layer instead of trusting its mere presence. Scanned PDFs
      // often contain a hidden OCR layer made of tiny fragments and single glyphs.
      const isolatedGlyphs = embeddedTextItems.filter((item) => item.text.trim().length <= 1).length;
      const averageItemLength = embeddedTextItems.reduce((sum, item) => sum + item.text.trim().length, 0) / Math.max(1, embeddedTextItems.length);
      const textCoverage = embeddedTextItems.reduce((sum, item) => sum + Math.max(0, item.width * item.height), 0) / Math.max(1, canvas.width * canvas.height);
      const singletonRatio = isolatedGlyphs / Math.max(1, embeddedTextItems.length);
      const documentScore = (hasTextLayer ? .35 : 0) + Math.min(.3, averageItemLength / 20) + Math.min(.25, textCoverage * 4) - Math.min(.5, singletonRatio * .9);
      const isDocument = hasTextLayer && documentScore >= .48;
      results.push({ url, width: canvas.width, height: canvas.height, name: `${name} · trang ${pageNumber}`, embeddedText: isDocument ? embeddedText : undefined, embeddedTextItems: isDocument ? embeddedTextItems : undefined, pdfKind: isDocument ? "document" : "scan" });
      page.cleanup();
    } return results; }
    catch (error) { results.forEach(({ url }) => { URL.revokeObjectURL(url); objectUrls.current.delete(url); }); throw error; }
    finally { await pdf.cleanup(); await loadingTask.destroy(); }
  }

  async function addFiles(files: FileList | File[]) {
    if (exporting) return;
    const candidates = Array.from(files);
    if (!candidates.length) return;
    const lease = importSession.current.start();
    if (lease === null) return;
    const isCurrentImport = () => importSession.current.isActive(lease);
    setImporting(true);
    setMessage(candidates.some((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) ? "Đang mở và dựng các trang PDF…" : "Đang mở ảnh…");
    const room = Math.max(0, 20 - pages.length);
    let sessionPixels = pages.reduce((total, page) => total + (page.sourcePixels ?? 0), 0);
    const next: ScanPage[] = [];
    const errors: string[] = [];
    let importedPdf = false;
    let importedDocumentPdf = false;
    try {
    for (const file of candidates.slice(0, room)) {
      if (!isCurrentImport()) return;
      try {
        const kind = await detectUploadKind(file);
        if (!isCurrentImport()) return;
        if (!kind) throw new Error(`${safeDisplayName(file.name)}: định dạng hoặc nội dung file không hợp lệ.`);
        const inspectedPages = kind === "pdf" ? await inspectPdf(file, room - next.length) : [{ ...(await inspectFile(file)), name: safeDisplayName(file.name) }];
        if (!isCurrentImport()) {
          inspectedPages.forEach(({ url }) => { URL.revokeObjectURL(url); objectUrls.current.delete(url); });
          return;
        }
        if (kind === "pdf") importedPdf = true;
        if (kind === "pdf" && inspectedPages.some((page) => Boolean(page.embeddedText))) importedDocumentPdf = true;
        const incomingPixels = inspectedPages.reduce((total, inspected) => total + inspected.width * inspected.height, 0);
        if (sessionPixels + incomingPixels > MAX_SESSION_PIXELS) {
          inspectedPages.forEach(({ url }) => { URL.revokeObjectURL(url); objectUrls.current.delete(url); });
          throw new Error("Tổng độ phân giải của phiên vượt giới hạn an toàn. Hãy xuất hoặc xóa bớt trang trước khi thêm tiếp.");
        }
        for (const inspected of inspectedPages) {
          const sourcePixels = inspected.width * inspected.height;
          const quality = await analyzeImageQuality(inspected.url, inspected.width, inspected.height);
          if (!isCurrentImport()) return;
          sessionPixels += sourcePixels;
          next.push({ id: crypto.randomUUID(), name: inspected.name, url: inspected.url, rotation: 0, fineRotation: 0, dewarp: true, corners: defaultCorners.map((p) => ({ ...p })) as typeof defaultCorners, settings: { ...defaultSettings }, qualityWarning: quality.warning, embeddedText: inspected.embeddedText, embeddedTextItems: inspected.embeddedTextItems, pdfKind: inspected.pdfKind, sourcePixels });
        }
      }
      catch (error) { errors.push(error instanceof Error ? error.message : `${file.name}: không thể đọc ảnh.`); }
    }
    if (!isCurrentImport()) return;
    if (!next.length) { setMessage(errors[0] ?? "Hãy chọn ảnh JPG, PNG, WebP hoặc PDF hợp lệ."); return; }
    if (!isCurrentImport()) return;
    setPages((current) => [...current, ...next]);
    setActiveId((current) => current || next[0].id);
    const hasDocumentPdf = importedDocumentPdf || pages.some((page) => Boolean(page.embeddedText));
    if (importedDocumentPdf || (pages.length === 0 && next.some((page) => Boolean(page.embeddedText)))) {
      setExportOptions((current) => ({ ...current, format: "docx", searchable: false }));
    } else if (!hasDocumentPdf && pages.length === 0) {
      setExportOptions((current) => ({ ...current, format: "pdf", searchable: false }));
    }
    setMessage(candidates.length > room
      ? "Đã đạt giới hạn 20 trang."
      : errors.length
        ? `${next.length} trang hợp lệ; ${errors[0]}`
        : importedDocumentPdf
          ? "Đã nhận diện PDF tài liệu · mặc định chuyển thẳng sang Word."
          : importedPdf
            ? "Đã nhận diện PDF scan · mặc định đóng gói lại thành PDF."
            : `Đã thêm ${next.length} ảnh · sẵn sàng chỉnh và xuất PDF.`);
    } finally {
      if (importSession.current.finish(lease)) setImporting(false);
    }
  }

  function updateActive(patch: Partial<ScanPage>) { if (active && !exporting) setPages((list) => list.map((page) => page.id === active.id ? { ...page, ...patch } : page)); }
  function updateSetting(key: keyof ScanPage["settings"], value: number | FilterName) { if (active) updateActive({ settings: { ...active.settings, [key]: value } }); }
  function selectFilter(filter: FilterName) {
    if (!active) return;
    if (filter === "original") updateActive({ settings: { ...defaultSettings } });
    else updateActive({ settings: { filter, brightness: 8, contrast: 22, whiten: 20, removeShadow: 28, sharpen: 18 } });
  }
  function applyToAll() { if (!active || exporting) return; setPages((list) => list.map((page) => ({ ...page, settings: { ...active.settings } }))); setMessage(`Đã áp dụng thiết lập cho ${pages.length} trang.`); }
  async function autoDetect() {
    if (!active || detecting || exporting) return;
    setDetecting(true); setShowOriginal(false); setMessage("Đang phân tích mép giấy…");
    try {
      const result = await detectDocumentCorners(active.url);
      if (result.confidence >= .58) { updateActive({ corners: result.corners }); setEditingCorners(true); setMessage(`Đã tìm thấy mép giấy · độ tin cậy ${Math.round(result.confidence * 100)}%. Hãy kiểm tra bốn góc.`); }
      else {
        const edgeWarning = "Kiểm tra 4 góc";
        const warning = active.qualityWarning?.includes(edgeWarning) ? active.qualityWarning : [active.qualityWarning, edgeWarning].filter(Boolean).join(" · ");
        updateActive({ qualityWarning: warning });
        setEditingCorners(true);
        setMessage(`Chưa đủ chắc chắn (${Math.round(result.confidence * 100)}%). Bốn góc hiện tại được giữ nguyên để bạn chỉnh tay.`);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không thể tự dò mép giấy."); }
    finally { setDetecting(false); }
  }
  function removePage(id: string) { if (exporting) return; const index = pages.findIndex((p) => p.id === id); URL.revokeObjectURL(pages[index].url); objectUrls.current.delete(pages[index].url); const next = pages.filter((p) => p.id !== id); setPages(next); if (id === activeId) setActiveId(next[Math.max(0, index - 1)]?.id ?? ""); }
  function movePage(index: number, delta: number) { if (exporting) return; const to = index + delta; if (to < 0 || to >= pages.length) return; setPages(arrayMove(pages, index, to)); }
  function onDragEnd(event: DragEndEvent) { const { active: from, over } = event; if (over && from.id !== over.id) setPages((list) => arrayMove(list, list.findIndex((p) => p.id === from.id), list.findIndex((p) => p.id === over.id))); }

  async function createSearchablePdf(exportPages: ScanPage[], maxEdge: number) {
    const [{ createWorker }, { PDFDocument }, fontkit] = await Promise.all([import("tesseract.js"), import("pdf-lib"), import("@pdf-lib/fontkit")]);
    const merged = await PDFDocument.create();
    merged.registerFontkit(fontkit.default);
    const fontBytes = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/NotoSans-Regular.ttf`).then((response) => {
      if (!response.ok) throw new Error("Không thể tải font Unicode cho lớp chữ PDF.");
      return response.arrayBuffer();
    });
    const unicodeFont = await merged.embedFont(fontBytes, { subset: true });
    let currentOcrPage = 0;
    const worker = await createWorker(selectedOcrLanguages(), undefined, {
      ...localOcrAssets,
      logger: (status) => {
        setProgress(Math.min(99, Math.round((currentOcrPage + status.progress) / exportPages.length * 100)));
      },
    });
    activeOcrWorkers.current.add(worker);
    await worker.setParameters({ tessedit_pageseg_mode: selectedPageSegmentation(exportOptions), preserve_interword_spaces: "1", user_defined_dpi: "300" });
    try {
      for (let index = 0; index < exportPages.length; index++) {
        currentOcrPage = index;
        if (cancelExport.current) throw new DOMException("Đã hủy xuất PDF", "AbortError");
        setMessage(`Đang nhận diện văn bản trang ${index + 1}/${exportPages.length}…`);
        const canvas = await renderPage(exportPages[index], maxEdge);
        let result = await recognizeWithTimeout(worker, worker.recognize(canvas, {}, { text: true, blocks: true }), index + 1);
        const candidateResults = [result];
        let retryCanvas = canvas;
        let bestScore = scoreOcrCandidate(result.data.text, result.data.confidence);
        if (result.data.confidence < 96 || bestScore < 92) {
          const enhancedPage: ScanPage = { ...exportPages[index], settings: { ...exportPages[index].settings, filter: "enhanced", removeShadow: Math.max(42, exportPages[index].settings.removeShadow), whiten: Math.max(24, exportPages[index].settings.whiten) } };
          const enhancedCanvas = await renderPage(enhancedPage, maxEdge);
          retryCanvas = enhancedCanvas;
          const enhancedResult = await recognizeWithTimeout(worker, worker.recognize(enhancedCanvas, {}, { text: true, blocks: true }), index + 1);
          candidateResults.push(enhancedResult);
          const enhancedScore = scoreOcrCandidate(enhancedResult.data.text, enhancedResult.data.confidence);
          if (enhancedScore > bestScore) { result = enhancedResult; bestScore = enhancedScore; }
          await worker.setParameters({ tessedit_pageseg_mode: "6" as PSM, preserve_interword_spaces: "1", user_defined_dpi: "300" });
          const blockResult = await recognizeWithTimeout(worker, worker.recognize(enhancedCanvas, {}, { text: true, blocks: true }), index + 1);
          candidateResults.push(blockResult);
          if (scoreOcrCandidate(blockResult.data.text, blockResult.data.confidence) > bestScore) result = blockResult;
          await worker.setParameters({ tessedit_pageseg_mode: selectedPageSegmentation(exportOptions), preserve_interword_spaces: "1", user_defined_dpi: "300" });
        }
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không thể mã hóa ảnh trang.")), "image/jpeg", .95));
        const image = await merged.embedJpg(await blob.arrayBuffer());
        // PDF units are physical points, not image pixels. Keeping raw canvas
        // pixels here made pasted Word text inherit ~28pt fonts and overflow.
        const pointScale = 842 / Math.max(canvas.width, canvas.height);
        const pageWidth = canvas.width * pointScale;
        const pageHeight = canvas.height * pointScale;
        const page = merged.addPage([pageWidth, pageHeight]);
        page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
        const lineSets = candidateResults.map((candidate) => candidate.data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines)).filter((line) => line.text.trim()) ?? []);
        const geometricLines = selectBestOcrLines(lineSets).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
        const suspiciousLines = geometricLines.filter((line) => isSuspiciousOcrLine(line.text, line.confidence)).slice(0, 10);
        if (suspiciousLines.length) {
          await worker.setParameters({ tessedit_pageseg_mode: "7" as PSM, preserve_interword_spaces: "1", user_defined_dpi: "300" });
          for (const line of suspiciousLines) {
            const padding = Math.max(8, Math.round((line.bbox.y1 - line.bbox.y0) * .45));
            const rectangle = { left: Math.max(0, Math.floor(line.bbox.x0 - padding)), top: Math.max(0, Math.floor(line.bbox.y0 - padding)), width: Math.min(retryCanvas.width, Math.ceil(line.bbox.x1 - line.bbox.x0 + padding * 2)), height: Math.min(retryCanvas.height, Math.ceil(line.bbox.y1 - line.bbox.y0 + padding * 2)) };
            const retry = await recognizeWithTimeout(worker, worker.recognize(retryCanvas, { rectangle }, { text: true, blocks: true }), index + 1);
            const retryText = cleanOcrPageLines(recognizedTextLines(retry.data.text)).join(" ");
            if (retryText && scoreOcrCandidate(retryText, retry.data.confidence) > scoreOcrCandidate(line.text, line.confidence)) {
              line.text = retryText;
              line.confidence = retry.data.confidence;
              line.words = [];
            }
          }
          await worker.setParameters({ tessedit_pageseg_mode: selectedPageSegmentation(exportOptions), preserve_interword_spaces: "1", user_defined_dpi: "300" });
        }
        const textLines = recognizedTextLines(result.data.text);
        // Use each OCR line's own bounding box. A single page-wide interpolation
        // causes hidden text to drift, leaving parts of the scan unselectable.
        if (geometricLines.length) {
          const cleanedPageLines = deduplicateOcrLines(cleanOcrPageLines(geometricLines.map((line) => {
            const repaired = line.words?.length ? repairFragmentedOcrWords(line.words.filter((word) => word.text?.trim() && word.bbox).map((word) => ({ text: word.text.trim(), normalizedText: word.text.trim(), confidence: word.confidence, bbox: word.bbox }))) : [];
            // Fragment repair alone can rejoin "s" + "ocial", but it does not
            // remove low-confidence glyphs.  Always run the repaired sequence
            // through the same noise filter used by editable Word export.
            return repaired.length ? postProcessOcrLine({ words: repaired }).text : (line.words?.length ? postProcessOcrLine(line).text : line.text.trim());
          })));
          const positionedLines = cleanedPageLines.map((text, lineIndex) => ({ text: sanitizeDocumentText(text), line: geometricLines[Math.min(lineIndex, geometricLines.length - 1)] })).filter((entry) => entry.text);
          const paragraphGroups: typeof positionedLines[] = [];
          const visualGaps = positionedLines.slice(1).map((entry, lineIndex) => Math.max(0, entry.line.bbox.y0 - positionedLines[lineIndex].line.bbox.y1)).sort((a, b) => a - b);
          const typicalGap = visualGaps[Math.floor(visualGaps.length / 2)] ?? 0;
          for (const entry of positionedLines) {
            const group = paragraphGroups.at(-1);
            const previous = group?.at(-1);
            const previousHeight = previous ? Math.max(8, previous.line.bbox.y1 - previous.line.bbox.y0) : 0;
            const currentHeight = Math.max(8, entry.line.bbox.y1 - entry.line.bbox.y0);
            const gap = previous ? entry.line.bbox.y0 - previous.line.bbox.y1 : Number.POSITIVE_INFINITY;
            const paragraphBreak = Math.max(Math.max(previousHeight, currentHeight) * 1.45, typicalGap * 1.65);
            if (!group || gap > paragraphBreak) paragraphGroups.push([entry]);
            else group.push(entry);
          }
          for (const group of paragraphGroups) {
            for (const { line, text } of group) {
              const width = Math.max(1, line.bbox.x1 - line.bbox.x0);
              const height = Math.max(8, line.bbox.y1 - line.bbox.y0);
              const naturalWidth = Math.max(1, unicodeFont.widthOfTextAtSize(text, 1));
              const size = Math.max(1, Math.min(height * .82, width / naturalWidth));
              page.drawText(text, { x: line.bbox.x0 * pointScale, y: (canvas.height - line.bbox.y1) * pointScale, size: size * pointScale, font: unicodeFont, opacity: 0 });
            }
          }
        } else {
          const lineStep = canvas.height * .04;
          textLines.forEach((text, lineIndex) => page.drawText(sanitizeDocumentText(text), { x: canvas.width * .08 * pointScale, y: (canvas.height * (.12 + lineIndex * lineStep / canvas.height)) * pointScale, size: lineStep * .65 * pointScale, font: unicodeFont, opacity: 0 }));
        }
        setProgress(Math.round((index + 1) / exportPages.length * 100));
        releaseCanvas(canvas, retryCanvas === canvas ? null : retryCanvas);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const bytes = await merged.save();
      const blob = new Blob([new Uint8Array(bytes).buffer], { type: "application/pdf" });
      downloadBlob(blob, `ak-scan-searchable-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      activeOcrWorkers.current.delete(worker);
      try { await worker.terminate(); } catch { /* Cancellation may have already stopped this worker. */ }
    }
  }

  async function createWordDocument(exportPages: ScanPage[], maxEdge: number) {
    const [{ createWorker }, { AlignmentType, Document, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType }] = await Promise.all([import("tesseract.js"), import("docx")]);
    let currentOcrPage = 0;
    const needsOcr = exportPages.some((page) => page.pdfKind === "scan" || !page.embeddedText);
    const worker = needsOcr ? await createWorker(selectedOcrLanguages(), undefined, {
      ...localOcrAssets,
      logger: (status) => setProgress(Math.min(99, Math.round((currentOcrPage + status.progress) / exportPages.length * 100))),
    }) : null;
    if (worker) activeOcrWorkers.current.add(worker);
    if (worker) await worker.setParameters({ tessedit_pageseg_mode: selectedPageSegmentation(exportOptions), preserve_interword_spaces: "1", user_defined_dpi: "300" });
    const paragraphs: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];
    try {
      for (let index = 0; index < exportPages.length; index++) {
        let hasPageContent = false;
        let previousWasList = false;
        let listInstance = index;
        const append = (element: InstanceType<typeof Paragraph> | InstanceType<typeof Table>) => {
          // A DOCX flows continuously by default. Preserve each source-PDF page.
          if (!hasPageContent && index > 0) paragraphs.push(new Paragraph({ pageBreakBefore: true }));
          paragraphs.push(element);
          hasPageContent = true;
        };
        const isOrderedList = (text: string) => /^\s*\d{1,3}[.)]\s+/.test(text);
        const withoutListMarker = (text: string) => sanitizeDocumentText(text.replace(/^\s*(?:\d{1,3}[.)]|[-•‣◦])\s+/, ""));
        const listProperties = (text: string, isList: boolean) => {
          if (!isList) { previousWasList = false; return {}; }
          if (!previousWasList) listInstance++;
          previousWasList = true;
          return isOrderedList(text)
            ? { numbering: { reference: "ak-numbered-list", level: 0, instance: listInstance } }
            : { bullet: { level: 0 } };
        };
        currentOcrPage = index;
        if (cancelExport.current) throw new DOMException("Đã hủy xuất Word", "AbortError");
        setMessage(`Đang đọc chữ trang ${index + 1}/${exportPages.length}…`);
        const sourcePage = exportPages[index];
        if (sourcePage.embeddedText) {
          if (sourcePage.embeddedTextItems?.length) {
            const tokens = tokensFromPdfTextItems(sourcePage.embeddedTextItems.map((item) => ({ str: item.text, transform: [1, 0, 0, item.height, item.x, item.y], width: item.width, height: item.height, fontName: item.fontName, hasEOL: item.hasEol })), index + 1);
            mergeDocumentParagraphs(analyzePageLayout(tokens)).forEach((block) => {
              if (block.kind === "table" && block.table) {
                previousWasList = false;
                append(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: block.table.rows.map((row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph(sanitizeDocumentText(cell))] })) })) }));
                return;
              }
              const size = Math.max(18, Math.min(42, Math.round((block.lines?.[0]?.fontSize ?? 11) * 2)));
              const isList = block.kind === "list-item";
              const sourceTokens = block.lines?.flatMap((line) => line.tokens) ?? [];
              const contentTokens = isList && sourceTokens.length > 1 && /^(?:\d{1,3}[.)]|[-•‣◦])$/.test(sourceTokens[0]?.text ?? "") ? sourceTokens.slice(1) : sourceTokens;
              const runs = contentTokens.length ? contentTokens.map((token, tokenIndex) => {
                const next = contentTokens[tokenIndex + 1]?.text ?? "";
                const suffix = /^[,.;:!?%…)}\]]/.test(next) || /[(\[]$/.test(token.text) ? "" : " ";
                return new TextRun({ text: `${sanitizeDocumentText(token.text)}${suffix}`, size, bold: Boolean(token.bold) || block.kind === "heading", italics: Boolean(token.italic) });
              }) : [new TextRun({ text: isList ? withoutListMarker(block.text ?? "") : sanitizeDocumentText(block.text ?? ""), size, bold: block.kind === "heading" })];
              append(new Paragraph({
                heading: block.kind === "heading" ? (block.level === 1 ? "Heading1" : "Heading2") : undefined,
                ...listProperties(block.text ?? "", isList),
                alignment: block.kind === "paragraph" ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
                indent: exportOptions.wordMode === "preserve-layout" ? { left: Math.max(0, Math.round(block.bbox.x0 * 20)) } : undefined,
                children: runs,
              }));
            });
          } else sourcePage.embeddedText.split(/\r?\n/).filter((line) => line.trim()).forEach((line) => append(new Paragraph({ children: [new TextRun(sanitizeDocumentText(line.trim()))] })));
          setProgress(Math.round((index + 1) / exportPages.length * 100));
          continue;
        }
        const grayscalePage: ScanPage = {
          ...sourcePage,
          settings: { ...sourcePage.settings, filter: "grayscale", removeShadow: Math.max(42, sourcePage.settings.removeShadow), whiten: Math.max(24, sourcePage.settings.whiten), sharpen: Math.min(22, sourcePage.settings.sharpen) },
        };
        const grayscale = await renderPage(grayscalePage, maxEdge);
        if (!worker) throw new Error("Không thể khởi tạo bộ nhận diện chữ.");
        let best = await recognizeWithTimeout(worker, worker.recognize(grayscale, {}, { text: true, blocks: true }), index + 1);
        const ocrCandidates = [best];

        // Faint, italic, or small text needs a genuinely different image, not
        // only another segmentation mode. The adaptive-binary profile is kept
        // for weak scans because it can erase useful tonal detail on clean PDF
        // renderings.
        for (const filter of ocrPreprocessFilters(best.data.confidence).slice(1)) {
          const variantPage: ScanPage = { ...sourcePage, settings: { ...grayscalePage.settings, filter } };
          const variant = await renderPage(variantPage, maxEdge);
          const alternative = await recognizeWithTimeout(worker, worker.recognize(variant, {}, { text: true, blocks: true }), index + 1);
          ocrCandidates.push(alternative);
          if (scoreOcrCandidate(alternative.data.text, alternative.data.confidence) > scoreOcrCandidate(best.data.text, best.data.confidence)) best = alternative;
          releaseCanvas(variant);
        }
        if (best.data.confidence < 96) {
          await worker.setParameters({ tessedit_pageseg_mode: "6" as PSM, preserve_interword_spaces: "1", user_defined_dpi: "300" });
          const alternateLayout = await recognizeWithTimeout(worker, worker.recognize(grayscale, {}, { text: true, blocks: true }), index + 1);
          ocrCandidates.push(alternateLayout);
          if (alternateLayout.data.confidence > best.data.confidence) best = alternateLayout;
          await worker.setParameters({ tessedit_pageseg_mode: selectedPageSegmentation(exportOptions), preserve_interword_spaces: "1", user_defined_dpi: "300" });
        }

        // For editable Word output, preserve Tesseract's complete reading order.
        // Geometry blocks can clip the first/last word or concatenate adjacent lines.
        const ocrWords = best.data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words ?? [])))
          .filter((word) => word.text?.trim() && word.bbox)
          .map((word) => ({ text: word.text.trim(), confidence: word.confidence, bbox: word.bbox })) ?? [];
        const repairedWords = repairFragmentedOcrWords(ocrWords);
        // A page-wide confidence score can hide one badly recognized line (most
        // often small italic text). Compare every rendered/segmentation attempt
        // row-by-row, then keep the strongest line from each candidate.
        const positionedCandidateLines = ocrCandidates.map((candidate) => candidate.data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
          .filter((line) => line.text.trim() && line.bbox)
          .map((line) => ({
            words: (line.words ?? []).filter((word) => word.text?.trim() && word.bbox).map((word) => ({ text: word.text.trim(), confidence: word.confidence, bbox: word.bbox })),
            text: line.text.trim(), confidence: line.confidence, bbox: line.bbox,
          })) ?? []);
        const selectedLines = selectBestOcrLines(positionedCandidateLines);
        // Whole-page layout modes remain best for reading order, while PSM 7
        // is markedly better for a faint, italic, or tightly-spaced visual
        // row. Retry only suspicious rows so we do not turn a structured page
        // into a stream of unrelated single-line OCR calls.
        const retryLines = selectedLines.filter((line) => isSuspiciousOcrLine(line.text, line.confidence)).slice(0, 10);
        if (retryLines.length) {
          await worker.setParameters({ tessedit_pageseg_mode: "7" as PSM, preserve_interword_spaces: "1", user_defined_dpi: "300" });
          for (const line of retryLines) {
            const padding = Math.max(10, Math.round((line.bbox.y1 - line.bbox.y0) * .6));
            const left = Math.max(0, Math.floor(line.bbox.x0 - padding));
            const top = Math.max(0, Math.floor(line.bbox.y0 - padding));
            const right = Math.min(grayscale.width, Math.ceil(line.bbox.x1 + padding));
            const bottom = Math.min(grayscale.height, Math.ceil(line.bbox.y1 + padding));
            const retry = await recognizeWithTimeout(worker, worker.recognize(grayscale, { rectangle: { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) } }, { text: true, blocks: true }), index + 1);
            const retryText = cleanOcrPageLines(recognizedTextLines(retry.data.text)).join(" ");
            if (retryText && scoreOcrCandidate(retryText, retry.data.confidence) > scoreOcrCandidate(line.text, line.confidence)) {
              line.text = retryText;
              line.confidence = retry.data.confidence;
              line.words = [];
            }
          }
          await worker.setParameters({ tessedit_pageseg_mode: selectedPageSegmentation(exportOptions), preserve_interword_spaces: "1", user_defined_dpi: "300" });
        }
        const cleanedLines = selectedLines.sort((a, b) => a.bbox.y0 - b.bbox.y0).map((line) => {
          if (!line.words.length) return line.text;
          const repaired = repairFragmentedOcrWords(line.words.map((word) => ({ ...word, normalizedText: word.text })));
          return repaired.length ? postProcessOcrLine({ words: repaired }).text : line.text;
        }).filter(Boolean);
        const pageLines = deduplicateOcrLines(cleanOcrPageLines(cleanedLines.length ? cleanedLines : recognizedTextLines(best.data.text)));
        const contentText = pageLines.length ? pageLines.join("\n") : (repairedWords.length ? repairedWords.map((word) => word.text).join(" ") : best.data.text);
        const contentLines = contentText.split(/\r?\n/).map((line) => sanitizeDocumentText(line)).filter(Boolean);
        const structuredParagraphs = structureOcrDocumentLines(contentLines.length ? contentLines : recognizedTextLines(best.data.text));
        structuredParagraphs.forEach((block) => {
          const isList = block.kind === "list-item";
          append(new Paragraph({
            heading: block.kind === "title" ? "Heading1" : block.kind === "heading" ? "Heading2" : undefined,
            alignment: block.kind === "paragraph" ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
            ...listProperties(block.text, isList),
            spacing: { before: block.kind === "heading" ? 180 : 0, after: block.kind === "title" ? 180 : block.kind === "heading" ? 100 : 80, line: 276, lineRule: "auto" },
            children: [new TextRun({
              text: isList ? withoutListMarker(block.text) : sanitizeDocumentText(block.text),
              size: block.kind === "title" ? 28 : block.kind === "heading" ? 22 : 20,
              bold: block.kind === "title" || block.kind === "heading",
              color: block.kind === "title" ? "1F4E79" : "000000",
              language: { value: "en-US" },
            })],
          }));
        });
        releaseCanvas(grayscale);
        setProgress(Math.round((index + 1) / exportPages.length * 100));
      }
      const wordDocument = new Document({ creator: "AK Scan", description: "Tài liệu Word có thể chỉnh sửa được chuyển đổi từ PDF trên thiết bị.", styles: { default: { document: { run: { font: "Arial", size: 22, language: { value: "en-US" } }, paragraph: { spacing: { after: 120, line: 276 } } } } }, numbering: { config: [{ reference: "ak-numbered-list", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, start: 1, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] }, sections: [{ children: paragraphs }] });
      const blob = await Packer.toBlob(wordDocument);
      downloadBlob(blob, `ak-scan-word-${new Date().toISOString().slice(0, 10)}.docx`);
    } finally {
      if (worker) activeOcrWorkers.current.delete(worker);
      try { await worker?.terminate(); } catch { /* Cancellation may have already stopped this worker. */ }
    }
  }

  async function exportPdf() {
    if (!pages.length || exporting) return;
    const exportPages = pages.map((page) => ({ ...page, corners: page.corners.map((p) => ({ ...p })) as typeof page.corners, settings: { ...page.settings } }));
    cancelExport.current = false; setExportOpen(false); setExporting(true); setProgress(0); setMessage("Đang tạo PDF trên thiết bị…");
    try {
      const maxEdge = exportOptions.quality === "compact" ? 1800 : exportOptions.quality === "high" ? 4800 : 3200;
      const jpegQuality = exportOptions.quality === "compact" ? .82 : exportOptions.quality === "high" ? .98 : .93;
      const margin = exportOptions.margin === "none" ? 0 : exportOptions.margin === "large" ? 15 : 8;
      if (exportOptions.format === "docx") {
        await createWordDocument(exportPages, Math.max(2800, maxEdge));
        setMessage("File Word đã được tạo với văn bản sạch, không tô màu.");
        return;
      }
      if (exportOptions.searchable) {
        await createSearchablePdf(exportPages, maxEdge);
        setMessage("PDF có thể tìm kiếm đã được tạo · văn bản được nhận diện ngay trên thiết bị.");
        return;
      }
      let pdf: jsPDF | null = null;
      for (let i = 0; i < exportPages.length; i++) {
        if (cancelExport.current) throw new DOMException("Đã hủy xuất PDF", "AbortError");
        const canvas = await renderPage(exportPages[i], maxEdge);
        const standard = exportOptions.pageSize === "letter" ? [215.9, 279.4] : [210, 297];
        const fitScale = 297 / Math.max(canvas.width, canvas.height);
        const dimensions = exportOptions.pageSize === "fit" ? [canvas.width * fitScale, canvas.height * fitScale] : standard;
        const [sheetW, sheetH] = dimensions;
        if (!pdf) pdf = new jsPDF({ unit: "mm", format: dimensions, orientation: sheetW > sheetH ? "landscape" : "portrait", compress: true });
        else pdf.addPage(dimensions, sheetW > sheetH ? "landscape" : "portrait");
        const pageW = sheetW - margin * 2, pageH = sheetH - margin * 2;
        const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
        const w = canvas.width * ratio, h = canvas.height * ratio;
        const lossless = exportPages[i].settings.filter === "bw";
        const imageData = await canvasToDataUrl(canvas, lossless ? "image/png" : "image/jpeg", lossless ? undefined : jpegQuality);
        pdf.addImage(imageData, lossless ? "PNG" : "JPEG", (sheetW - w) / 2, (sheetH - h) / 2, w, h, undefined, "MEDIUM");
        releaseCanvas(canvas);
        setProgress(Math.round(((i + 1) / exportPages.length) * 100));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (!pdf) throw new Error("Không có trang hợp lệ để xuất.");
      downloadBlob(pdf.output("blob"), `ak-scan-${new Date().toISOString().slice(0, 10)}.pdf`);
      setMessage("PDF đã được tạo. Ảnh vẫn chỉ nằm trên thiết bị này.");
    } catch (error) {
      console.warn("PDF export failed", error);
      setMessage(readableExportError(error));
    }
    finally { setExporting(false); }
  }

  function clearSession() {
    if (exporting) return;
    importSession.current.cancel();
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
    setPages([]);
    setActiveId("");
    setImporting(false);
    setMessage("Đã xóa toàn bộ phiên làm việc.");
  }

  return (
    <main className="app-shell">
      <AppHeader hasPages={pages.length > 0} exporting={exporting} onClearSession={clearSession} />
      <PageToc />

      {!pages.length ? (
        <HomeUpload dragging={dragging} importing={importing} fileRef={fileRef} pdfRef={pdfRef} cameraRef={cameraRef} onDraggingChange={setDragging} onFiles={(files) => void addFiles(files)} />
      ) : (
        <section id="workspace" className={`workbench ${exporting ? "exporting" : ""}`} aria-label="Bàn chỉnh sửa tài liệu" aria-busy={exporting}>
          <aside className="pages-panel">
            <div className="panel-heading">
              <div><span>TRANG</span><strong>{pages.length}/20</strong></div>
              <div className="panel-add-actions">
                <button disabled={importing} onClick={() => fileRef.current?.click()} aria-label="Thêm ảnh" title="Thêm ảnh"><ImagePlus size={18} /></button>
                <button disabled={importing} onClick={() => pdfRef.current?.click()} aria-label="Thêm PDF" title="Thêm PDF"><FileText size={17} /></button>
              </div>
            </div>
            <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
            <input ref={pdfRef} className="sr-only" type="file" accept="application/pdf,.pdf" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
            <DndContext sensors={sensors} onDragStart={() => setDragging(true)} onDragCancel={() => setDragging(false)} onDragEnd={(e) => { setDragging(false); onDragEnd(e); }}>
              <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                <ol className="page-list">
                  {pages.map((page, index) => <SortablePage key={page.id} page={page} index={index} last={index === pages.length - 1} active={active?.id === page.id} onSelect={() => setActiveId(page.id)} onDelete={() => removePage(page.id)} onMove={(delta) => movePage(index, delta)} />)}
                </ol>
              </SortableContext>
            </DndContext>
          </aside>

          <section className="canvas-panel">
            <div className="canvas-toolbar">
              <div className="crop-tools">
                <button className={`crop-toggle ${editingCorners ? "selected" : ""}`} onClick={() => { setEditingCorners((value) => !value); setShowOriginal(false); }} aria-pressed={editingCorners}>
                  <Crop size={16} /> {editingCorners ? "Xong chỉnh góc" : "Chỉnh 4 góc"}
                </button>
                <button className="detect-button" onClick={() => void autoDetect()} disabled={detecting}>
                  {detecting ? <LoaderCircle className="detect-spinner" size={16} /> : <ScanSearch size={16} />} {detecting ? "Đang dò…" : "Tự dò mép"}
                </button>
              </div>
              <div>
                {editingCorners && <button onClick={() => updateActive({ corners: defaultCorners.map((p) => ({ ...p })) as typeof defaultCorners })}>Đặt lại</button>}
                <button className={showOriginal ? "selected" : ""} onClick={() => { setShowOriginal((value) => !value); setEditingCorners(false); }} aria-pressed={showOriginal}>
                  <Eye size={17} /> {showOriginal ? "Đang xem gốc" : "Xem ảnh gốc"}
                </button>
                <button onClick={() => updateActive({ rotation: (active.rotation + 270) % 360 })} aria-label="Xoay trái"><RotateCw className="flip" size={17} /></button>
                <button onClick={() => updateActive({ rotation: (active.rotation + 90) % 360 })} aria-label="Xoay phải"><RotateCw size={17} /></button>
              </div>
            </div>
            {active && <ScanPreview page={active} editing={editingCorners} showOriginal={showOriginal} onCornersChange={(corners) => updateActive({ corners })} />}
          </section>

          <aside className="controls-panel">
            <div>
              <div className="panel-title">
                <SlidersHorizontal size={16} />
                <h2>Chỉnh bản scan</h2>
              </div>
              {active.qualityWarning && <div className="quality-alert"><AlertTriangle size={15} /><div><span>{active.qualityWarning}</span></div>{active.qualityWarning.includes("4 góc") && <button onClick={() => { setEditingCorners(true); setShowOriginal(false); }}>Xem</button>}</div>}
              
              <p className="control-section-label">Chế độ trang</p>
              <div className="filter-grid">{filters.map((filter) => <button key={filter.id} className={active.settings.filter === filter.id ? "selected" : ""} onClick={() => selectFilter(filter.id)} aria-pressed={active.settings.filter === filter.id}><span className={`filter-swatch ${filter.id}`} />{filter.label}</button>)}</div>
              
              <div className="adjustment-group">
                <p className="control-section-label">Căn trang</p>
                <div className="sliders">
                  <label><span>Căn thẳng<output>{(active.fineRotation ?? 0).toFixed(1)}°</output></span><input type="range" min={-3} max={3} step={.1} value={active.fineRotation ?? 0} onChange={(event) => updateActive({ fineRotation: Number(event.target.value) })} /></label>
                </div>
                <button className={`dewarp-toggle ${active.dewarp ? "selected" : ""}`} aria-pressed={Boolean(active.dewarp)} title="Chỉ nắn ảnh khi phát hiện đường chữ cong đủ tin cậy" onClick={() => {
                  const enabled = !active.dewarp;
                  updateActive({ dewarp: enabled });
                  setShowOriginal(false);
                  setEditingCorners(false);
                  setMessage(enabled ? "Đã bật làm phẳng an toàn · ảnh chỉ được nắn khi phát hiện đường chữ cong đủ tin cậy." : "Đã tắt làm phẳng giấy cong.");
                }}>
                  <span><ScanLine size={16} /> <strong>Làm phẳng giấy cong</strong></span>
                  <span className="toggle-state">{active.dewarp ? "Bật" : "Tắt"}</span>
                </button>
              </div>

              <div className={`adjustment-group ${active.settings.filter === "original" ? "disabled" : ""}`}>
                <p className="control-section-label">Làm sạch &amp; tăng nét</p>
                <div className="sliders">{([ ["brightness", "Độ sáng", -30, 40], ["contrast", "Tương phản", 0, 60], ["whiten", "Trắng nền", 0, 80], ["removeShadow", "Xóa bóng", 0, 80], ["sharpen", "Sắc nét", 0, 60] ] as const).map(([key,label,min,max]) => <label key={key}><span>{label}<output>{active.settings[key]}</output></span><input type="range" min={min} max={max} value={active.settings[key]} disabled={active.settings.filter === "original"} onChange={(e) => updateSetting(key, Number(e.target.value))} /></label>)}</div>
              </div>

              <div className="control-actions">
                <button className="reset" onClick={() => updateActive({ settings: { ...defaultSettings }, fineRotation: 0, dewarp: true })}>Đặt lại</button>
                <button className="reset" onClick={applyToAll}>Áp dụng mọi trang</button>
              </div>
            </div>

            <div className="export-box">
              <div><strong>{exportOptions.format === "docx" ? "Sẵn sàng chuyển Word" : "Sẵn sàng xuất"}</strong><span>{pages.length} trang · {exportOptions.format === "docx" ? (exportOptions.wordMode === "editable" ? "Dễ chỉnh sửa" : "Giữ bố cục") : (exportOptions.pageSize === "fit" ? "Vừa ảnh" : exportOptions.pageSize.toUpperCase())}</span></div>
              <button className="button primary export" onClick={() => setExportOpen(true)} disabled={exporting}>
                {exporting ? <><span className="spinner light" /> Đang xử lý {progress}%</> : <><Download size={18} /> Tùy chọn & tải {exportOptions.format === "docx" ? "Word" : "PDF"}</>}
              </button>
              {exporting && <><div className="progress"><span style={{ transform: `scaleX(${progress / 100})` }} /></div><button className="cancel-export" onClick={cancelCurrentExport}>Hủy xuất</button></>}
            </div>
          </aside>
        </section>
      )}

      {pages.length > 0 && <ExportGuide />}
      <ExportDialog open={exportOpen} pageCount={pages.length} options={exportOptions} onChange={setExportOptions} onClose={() => setExportOpen(false)} onExport={() => void exportPdf()} />
      <p className="live-message" aria-live="polite">{message}</p>

      <HomeGuide />
      <AppFooter />
      <DonateWidget inWorkbench={pages.length > 0} />
    </main>
  );
}

