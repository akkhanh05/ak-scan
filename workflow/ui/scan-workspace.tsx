"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DndContext, DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AlertTriangle, Crop, Download, Eye, FileText, ImagePlus, LoaderCircle, Redo2, RotateCw, ScanLine, ScanSearch, Share2, SlidersHorizontal, Undo2 } from "lucide-react";
import { defaultCorners, defaultSettings } from "@/workflow/shared/core/scan";
import type { FilterName, ScanPage } from "@/workflow/shared/core/scan";
import { defaultExportOptions } from "@/workflow/shared/core/export-options";
import type { ExportOptions } from "@/workflow/shared/core/export-options";
import { hasTextLayer } from "@/workflow/shared/core/export-pipeline";
import { ImportSessionController } from "@/workflow/shared/core/import-session";
import { ImportError, MAX_PAGES, importImage, openPdf, sessionPixelBudget } from "@/workflow/shared/core/import-adapter";
import type { ImportedPage } from "@/workflow/shared/core/import-adapter";
import { detectUploadKind, safeDisplayName } from "@/workflow/shared/core/upload-security";
import { getRenderClient } from "@/workflow/shared/core/render-client";
import { clearDraft, draftSummary, isDraftEnabled, loadDraft, saveDraft, setDraftEnabled, subscribeDraftSetting } from "@/workflow/shared/core/draft-store";
import type { DraftSummary } from "@/workflow/shared/core/draft-store";
import { shouldApplyDetectedCrop } from "@/workflow/scan-from-image/core";
import { ScanPreview } from "./scan-preview";
import { ExportDialog } from "./export-dialog";
import { HomeGuide } from "./home-guide";
import { DonateWidget } from "./donate-widget";
import { AppFooter } from "./app-footer";
import { AppHeader } from "./app-header";
import { HomeUpload } from "./home-upload";
import { SortablePage } from "./sortable-page";
import { ExportGuide } from "./export-guide";
import { PageToc } from "./page-toc";
import { PageRangeDialog } from "./page-range-dialog";
import type { PageRangeRequest } from "./page-range-dialog";
import { OcrReviewDialog } from "./ocr-review-dialog";
import type { ReviewPage } from "./ocr-review-dialog";
import { usePageHistory } from "./use-page-history";
import { ExportRun, downloadBlob, readableExportError } from "./export-runner";

const filters: Array<{ id: FilterName; label: string }> = [
  { id: "original", label: "Ảnh gốc" }, { id: "enhanced", label: "Tăng cường" },
  { id: "grayscale", label: "Xám" }, { id: "bw", label: "Trắng đen" },
];

function newPage(imported: ImportedPage, extra: Partial<ScanPage> = {}): ScanPage {
  return {
    id: crypto.randomUUID(),
    name: imported.name,
    url: imported.url,
    rotation: 0,
    fineRotation: 0,
    dewarp: true,
    corners: defaultCorners.map((point) => ({ ...point })) as ScanPage["corners"],
    settings: { ...defaultSettings },
    pdfKind: imported.pdfKind,
    pdfPage: imported.pdfPage,
    sourceWidth: imported.width,
    sourceHeight: imported.height,
    sourcePixels: imported.width * imported.height,
    ...extra,
  };
}

export function ScanWorkspace() {
  const history = usePageHistory();
  const { pages, commit, registerUrl, revokeUnregistered } = history;
  const [activeId, setActiveId] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [editingCorners, setEditingCorners] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>(defaultExportOptions);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [rangeRequest, setRangeRequest] = useState<PageRangeRequest | null>(null);
  const [reviewPages, setReviewPages] = useState<ReviewPage[] | null>(null);
  const [lastExport, setLastExport] = useState<{ blob: Blob; filename: string } | null>(null);
  const draftEnabled = useSyncExternalStore(subscribeDraftSetting, isDraftEnabled, () => false);
  const [draft, setDraft] = useState<DraftSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const importSession = useRef(new ImportSessionController());
  const exportRun = useRef<ExportRun | null>(null);
  const rangeResolver = useRef<((range: [number, number] | null) => void) | null>(null);
  const reviewResolver = useRef<((corrections: Map<string, string[]> | null) => void) | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const active = pages.find((page) => page.id === activeId) ?? pages[0];

  // ── lifecycle ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isDraftEnabled()) draftSummary().then(setDraft).catch(() => setDraft(null));
    const session = importSession.current;
    return () => {
      session.cancel();
      exportRun.current?.cancel();
      getRenderClient().cancelAll();
    };
  }, []);

  // Leaving the page loses the session unless a draft is kept.
  useEffect(() => {
    if (!pages.length || draftEnabled) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pages.length, draftEnabled]);

  // Opt-in draft persistence (debounced).
  useEffect(() => {
    if (!draftEnabled || importing) return;
    const timer = window.setTimeout(() => {
      (pages.length ? saveDraft(pages) : clearDraft()).catch(() => setMessage("Không lưu được bản nháp trên trình duyệt này."));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [pages, draftEnabled, importing]);

  const busy = exporting || importing;

  // Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || busy) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range"))) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) { event.preventDefault(); history.undo(); }
      else if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); history.redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, history]);

  // ── import ───────────────────────────────────────────────────────────────
  const askRange = useCallback((request: PageRangeRequest) => new Promise<[number, number] | null>((resolve) => {
    rangeResolver.current = resolve;
    setRangeRequest(request);
  }), []);

  async function addFiles(files: FileList | File[]) {
    if (busy) return;
    const candidates = Array.from(files);
    if (!candidates.length) return;
    const lease = importSession.current.start();
    if (lease === null) return;
    const isCurrent = () => importSession.current.isActive(lease);
    setImporting(true);
    setLastExport(null);
    const budget = sessionPixelBudget();
    let sessionPixels = pages.reduce((total, page) => total + (page.sourcePixels ?? 0), 0);
    const added: ScanPage[] = [];
    const notes: string[] = [];
    const room = () => MAX_PAGES - pages.length - added.length;
    const client = getRenderClient();
    try {
      for (const file of candidates) {
        if (!isCurrent()) return;
        const name = safeDisplayName(file.name);
        if (room() <= 0) { notes.push(`${name}: bỏ qua vì đã đủ ${MAX_PAGES} trang`); continue; }
        try {
          const kind = await detectUploadKind(file);
          if (!kind) throw new ImportError(`${name}: định dạng hoặc nội dung file không hợp lệ.`);
          if (kind === "pdf") {
            setMessage(`Đang mở ${name}…`);
            const pdf = await openPdf(file);
            try {
              let first = 1, last = pdf.numPages;
              if (pdf.numPages > room()) {
                const range = await askRange({ fileName: name, numPages: pdf.numPages, room: room() });
                if (!range) { notes.push(`${name}: đã bỏ qua theo lựa chọn của bạn`); continue; }
                [first, last] = range;
                notes.push(`${name}: nhập trang ${first}–${last}/${pdf.numPages}`);
              }
              for (let number = first; number <= last; number++) {
                if (!isCurrent()) return;
                const pixels = await pdf.renderedPixels(number);
                if (sessionPixels + pixels > budget) { notes.push(`${name}: dừng ở trang ${number - 1} vì vượt giới hạn bộ nhớ an toàn của phiên`); break; }
                setMessage(`Đang dựng ${name} · trang ${number}/${last}…`);
                const imported = await pdf.renderPage(number, registerUrl);
                if (!isCurrent()) { revokeUnregistered(imported.url); return; }
                sessionPixels += imported.width * imported.height;
                added.push(newPage(imported));
              }
            } finally {
              await pdf.close();
            }
          } else {
            setMessage(`Đang mở ${name}…`);
            const imported = await importImage(file, registerUrl);
            if (!isCurrent()) { revokeUnregistered(imported.url); return; }
            if (sessionPixels + imported.width * imported.height > budget) {
              revokeUnregistered(imported.url);
              throw new ImportError(`${name}: tổng độ phân giải của phiên vượt giới hạn an toàn. Hãy xuất hoặc xóa bớt trang.`);
            }
            sessionPixels += imported.width * imported.height;
            // Quality check and automatic crop run in the render worker.
            const [quality, detection] = await Promise.all([
              client.quality(imported.url, imported.width, imported.height).catch(() => undefined),
              client.detect(imported.url).catch(() => undefined),
            ]);
            const autoCrop = shouldApplyDetectedCrop(detection?.detection);
            const warning = [quality?.quality?.warning, detection?.detection && !autoCrop ? "Kiểm tra 4 góc" : undefined].filter(Boolean).join(" · ") || undefined;
            added.push(newPage(imported, { qualityWarning: warning, corners: autoCrop ? detection!.detection!.corners : defaultCorners.map((point) => ({ ...point })) as ScanPage["corners"] }));
          }
        } catch (error) {
          notes.push(error instanceof Error ? error.message : `${name}: không thể đọc file.`);
        }
      }
      if (!isCurrent()) return;
      if (!added.length) { setMessage(notes[0] ?? "Hãy chọn ảnh JPG, PNG, WebP hoặc PDF hợp lệ."); return; }
      commit((current) => [...current, ...added]);
      setActiveId((current) => current || added[0].id);
      const documents = added.filter(hasTextLayer).length;
      const photos = added.filter((page) => !page.pdfKind).length;
      if (documents && pages.length === 0) setExportOptions((current) => ({ ...current, format: "docx", searchable: false }));
      else if (!documents && pages.length === 0) setExportOptions((current) => ({ ...current, format: "pdf", searchable: false }));
      const summary = [
        `Đã thêm ${added.length} trang`,
        documents ? `${documents} trang PDF có lớp chữ (mặc định chuyển sang Word)` : "",
        added.length - documents - photos ? `${added.length - documents - photos} trang PDF scan` : "",
        photos ? `${photos} ảnh${added.some((page) => !page.pdfKind && !page.qualityWarning?.includes("4 góc")) ? " · đã tự căn mép giấy, hãy kiểm tra" : ""}` : "",
      ].filter(Boolean).join(" · ");
      setMessage(notes.length ? `${summary}. Lưu ý: ${notes.join("; ")}.` : `${summary}.`);
    } finally {
      // An import cancelled half-way (session cleared) must not leak page images.
      if (!isCurrent()) added.forEach((page) => revokeUnregistered(page.url));
      if (importSession.current.finish(lease)) setImporting(false);
    }
  }

  // ── editing ──────────────────────────────────────────────────────────────
  function updateActive(patch: Partial<ScanPage>, mergeKey?: string) {
    if (!active || exporting) return;
    commit((list) => list.map((page) => page.id === active.id ? { ...page, ...patch } : page), mergeKey ? `${active.id}:${mergeKey}` : undefined);
  }
  function updateSetting(key: keyof ScanPage["settings"], value: number | FilterName) {
    if (active) updateActive({ settings: { ...active.settings, [key]: value } }, `setting:${key}`);
  }
  function selectFilter(filter: FilterName) {
    if (!active) return;
    if (filter === "original") updateActive({ settings: { ...defaultSettings } });
    else updateActive({ settings: { filter, brightness: 8, contrast: 22, whiten: 20, removeShadow: 28, sharpen: 18 } });
  }
  function applyToAll() {
    if (!active || exporting) return;
    commit((list) => list.map((page) => ({ ...page, settings: { ...active.settings } })));
    setMessage(`Đã áp dụng thiết lập cho ${pages.length} trang. Nhấn Ctrl+Z để hoàn tác.`);
  }
  async function autoDetect() {
    if (!active || detecting || exporting) return;
    setDetecting(true); setShowOriginal(false); setMessage("Đang phân tích mép giấy…");
    try {
      const detection = (await getRenderClient().detect(active.url)).detection;
      if (detection && shouldApplyDetectedCrop(detection)) {
        updateActive({ corners: detection.corners, qualityWarning: active.qualityWarning?.replace(/ ?·? ?Kiểm tra 4 góc/, "") || undefined });
        setEditingCorners(true);
        setMessage(`Đã tìm thấy mép giấy · độ tin cậy ${Math.round(detection.confidence * 100)}%. Hãy kiểm tra bốn góc.`);
      } else {
        const warning = active.qualityWarning?.includes("Kiểm tra 4 góc") ? active.qualityWarning : [active.qualityWarning, "Kiểm tra 4 góc"].filter(Boolean).join(" · ");
        updateActive({ qualityWarning: warning });
        setEditingCorners(true);
        setMessage(`Chưa đủ chắc chắn (${Math.round((detection?.confidence ?? 0) * 100)}%). Bốn góc hiện tại được giữ nguyên để bạn chỉnh tay.`);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không thể tự dò mép giấy."); }
    finally { setDetecting(false); }
  }
  function removePage(id: string) {
    if (exporting) return;
    const index = pages.findIndex((page) => page.id === id);
    const next = pages.filter((page) => page.id !== id);
    commit(() => next);
    if (id === activeId) setActiveId(next[Math.max(0, index - 1)]?.id ?? "");
    setMessage("Đã xóa trang. Nhấn Ctrl+Z để hoàn tác.");
  }
  function movePage(index: number, delta: number) {
    if (exporting) return;
    const to = index + delta;
    if (to < 0 || to >= pages.length) return;
    commit((list) => arrayMove(list, index, to));
  }
  function onDragEnd(event: DragEndEvent) {
    const { active: from, over } = event;
    if (over && from.id !== over.id) commit((list) => arrayMove(list, list.findIndex((p) => p.id === from.id), list.findIndex((p) => p.id === over.id)));
  }

  // ── export ───────────────────────────────────────────────────────────────
  const review = useCallback((list: ReviewPage[]) => new Promise<Map<string, string[]> | null>((resolve) => {
    reviewResolver.current = resolve;
    setReviewPages(list);
  }), []);

  async function runExport() {
    if (!pages.length || exporting) return;
    const snapshot = pages.map((page) => ({ ...page, corners: page.corners.map((p) => ({ ...p })) as ScanPage["corners"], settings: { ...page.settings } }));
    const run = new ExportRun();
    exportRun.current = run;
    setExportOpen(false); setExporting(true); setProgress(0); setLastExport(null);
    setMessage("Đang chuẩn bị xuất file trên thiết bị…");
    try {
      const outcome = await run.run(snapshot, exportOptions, ({ message: text, percent }) => { setMessage(text); setProgress(percent); }, review);
      downloadBlob(outcome.blob, outcome.filename);
      setLastExport({ blob: outcome.blob, filename: outcome.filename });
      setProgress(100);
      setMessage(outcome.message);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) console.warn("Export failed", error);
      setMessage(readableExportError(error));
    } finally {
      exportRun.current = null;
      setReviewPages(null);
      setExporting(false);
    }
  }

  function cancelExport() {
    exportRun.current?.cancel();
    reviewResolver.current?.(null);
    reviewResolver.current = null;
  }

  const canShare = Boolean(lastExport && typeof navigator !== "undefined" && "canShare" in navigator);
  async function shareLast() {
    if (!lastExport) return;
    const file = new File([lastExport.blob], lastExport.filename, { type: lastExport.blob.type });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: lastExport.filename });
      else setMessage("Trình duyệt này chưa hỗ trợ chia sẻ file trực tiếp. File đã nằm trong thư mục Tải xuống.");
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) setMessage("Không thể mở bảng chia sẻ của thiết bị.");
    }
  }

  // ── session & drafts ─────────────────────────────────────────────────────
  function clearSession() {
    if (exporting) return;
    importSession.current.cancel();
    getRenderClient().cancelAll();
    history.reset([]);
    setActiveId("");
    setImporting(false);
    setLastExport(null);
    if (draftEnabled) void clearDraft();
    setMessage("Đã xóa toàn bộ phiên làm việc.");
  }

  async function toggleDraft(enabled: boolean) {
    setDraftEnabled(enabled);
    if (!enabled) { await clearDraft(); setDraft(null); setMessage("Đã tắt lưu nháp và xóa bản nháp khỏi trình duyệt."); }
    else setMessage("Đã bật lưu nháp: phiên được lưu trong trình duyệt của máy này, không gửi đi đâu.");
  }

  async function restoreDraft() {
    try {
      const restored = await loadDraft(registerUrl);
      history.reset(restored);
      setActiveId(restored[0]?.id ?? "");
      setDraft(null);
      setMessage(`Đã khôi phục ${restored.length} trang từ bản nháp.`);
    } catch {
      setMessage("Không đọc được bản nháp. Bạn có thể xóa bản nháp và bắt đầu lại.");
    }
  }

  const textLayerPages = pages.filter(hasTextLayer).length;

  return (
    <main className="app-shell">
      <AppHeader hasPages={pages.length > 0} exporting={exporting} onClearSession={clearSession} draftEnabled={draftEnabled} onToggleDraft={(value) => void toggleDraft(value)} />
      <PageToc />

      {draft && !pages.length && (
        <div className="draft-banner" role="status">
          <span>Có bản nháp {draft.pageCount} trang lưu lúc {new Date(draft.savedAt).toLocaleString("vi-VN")} trên máy này.</span>
          <button className="button primary small" onClick={() => void restoreDraft()}>Khôi phục</button>
          <button className="button secondary small" onClick={() => { void clearDraft(); setDraft(null); }}>Xóa bản nháp</button>
        </div>
      )}

      {!pages.length ? (
        <HomeUpload dragging={dragging} importing={importing} fileRef={fileRef} pdfRef={pdfRef} cameraRef={cameraRef} onDraggingChange={setDragging} onFiles={(files) => void addFiles(files)} />
      ) : active && (
        <section id="workspace" className={`workbench ${exporting ? "exporting" : ""}`} aria-label="Bàn chỉnh sửa tài liệu" aria-busy={exporting}>
          <aside className="pages-panel">
            <div className="panel-heading">
              <div><span>TRANG</span><strong>{pages.length}/{MAX_PAGES}</strong></div>
              <div className="panel-add-actions">
                <button disabled={busy || pages.length >= MAX_PAGES} onClick={() => fileRef.current?.click()} aria-label="Thêm ảnh" title="Thêm ảnh"><ImagePlus size={18} /></button>
                <button disabled={busy || pages.length >= MAX_PAGES} onClick={() => pdfRef.current?.click()} aria-label="Thêm PDF" title="Thêm PDF"><FileText size={17} /></button>
              </div>
            </div>
            <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
            <input ref={pdfRef} className="sr-only" type="file" accept="application/pdf,.pdf" multiple onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
            <DndContext sensors={sensors} onDragStart={() => setDragging(true)} onDragCancel={() => setDragging(false)} onDragEnd={(e) => { setDragging(false); onDragEnd(e); }}>
              <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                <ol className="page-list">
                  {pages.map((page, index) => <SortablePage key={page.id} page={page} index={index} last={index === pages.length - 1} active={active.id === page.id} onSelect={() => setActiveId(page.id)} onDelete={() => removePage(page.id)} onMove={(delta) => movePage(index, delta)} />)}
                </ol>
              </SortableContext>
            </DndContext>
          </aside>

          <section className="canvas-panel">
            <div className="canvas-toolbar">
              <div className="crop-tools">
                <button className={`crop-toggle ${editingCorners ? "selected" : ""}`} onClick={() => { setEditingCorners((value) => !value); setShowOriginal(false); }} aria-pressed={editingCorners} aria-label={editingCorners ? "Xong chỉnh góc" : "Chỉnh 4 góc"} title="Chỉnh 4 góc">
                  <Crop size={16} /> <span className="toolbar-label-main">{editingCorners ? "Xong chỉnh góc" : "Chỉnh 4 góc"}</span>
                </button>
                <button className="detect-button" onClick={() => void autoDetect()} disabled={detecting || exporting} aria-label="Tự dò mép giấy" title="Tự dò mép giấy">
                  {detecting ? <LoaderCircle className="detect-spinner" size={16} /> : <ScanSearch size={16} />} <span className="toolbar-label">{detecting ? "Đang dò…" : "Tự dò mép"}</span>
                </button>
              </div>
              <div>
                <button onClick={history.undo} disabled={!history.canUndo || busy} aria-label="Hoàn tác (Ctrl+Z)" title="Hoàn tác (Ctrl+Z)"><Undo2 size={17} /></button>
                <button onClick={history.redo} disabled={!history.canRedo || busy} aria-label="Làm lại (Ctrl+Shift+Z)" title="Làm lại (Ctrl+Shift+Z)"><Redo2 size={17} /></button>
                {editingCorners && <button onClick={() => updateActive({ corners: defaultCorners.map((p) => ({ ...p })) as ScanPage["corners"] })}>Đặt lại</button>}
                <button className={showOriginal ? "selected" : ""} onClick={() => { setShowOriginal((value) => !value); setEditingCorners(false); }} aria-pressed={showOriginal} aria-label="Xem ảnh gốc" title="Xem ảnh gốc">
                  <Eye size={17} /> <span className="toolbar-label">{showOriginal ? "Đang xem gốc" : "Xem ảnh gốc"}</span>
                </button>
                <button onClick={() => updateActive({ rotation: (active.rotation + 270) % 360 })} aria-label="Xoay trái" title="Xoay trái"><RotateCw className="flip" size={17} /></button>
                <button onClick={() => updateActive({ rotation: (active.rotation + 90) % 360 })} aria-label="Xoay phải" title="Xoay phải"><RotateCw size={17} /></button>
              </div>
            </div>
            <ScanPreview page={active} editing={editingCorners} showOriginal={showOriginal} onCornersChange={(corners) => updateActive({ corners }, "corners")} />
          </section>

          <aside className="controls-panel">
            <div>
              <div className="panel-title">
                <SlidersHorizontal size={16} />
                <h2>Chỉnh bản scan</h2>
              </div>
              {hasTextLayer(active) && <p className="page-kind-note" role="note"><FileText size={13} /> PDF có lớp chữ · dùng chữ gốc, không cần nhận diện.</p>}
              {active.qualityWarning && <div className="quality-alert"><AlertTriangle size={15} /><div><span>{active.qualityWarning}</span></div>{active.qualityWarning.includes("4 góc") && <button onClick={() => { setEditingCorners(true); setShowOriginal(false); }}>Xem</button>}</div>}

              <p className="control-section-label">Chế độ trang</p>
              <div className="filter-grid">{filters.map((filter) => <button key={filter.id} className={active.settings.filter === filter.id ? "selected" : ""} onClick={() => selectFilter(filter.id)} aria-pressed={active.settings.filter === filter.id}><span className={`filter-swatch ${filter.id}`} />{filter.label}</button>)}</div>

              <div className="adjustment-group">
                <p className="control-section-label">Căn trang</p>
                <div className="sliders">
                  <label><span>Căn thẳng<output>{(active.fineRotation ?? 0).toFixed(1)}°</output></span><input type="range" min={-3} max={3} step={.1} value={active.fineRotation ?? 0} onChange={(event) => updateActive({ fineRotation: Number(event.target.value) }, "fineRotation")} /></label>
                </div>
                {!hasTextLayer(active) && (
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
                )}
              </div>

              <div className={`adjustment-group ${active.settings.filter === "original" ? "disabled" : ""}`}>
                <p className="control-section-label">Làm sạch &amp; tăng nét</p>
                <div className="sliders">{([["brightness", "Độ sáng", -30, 40], ["contrast", "Tương phản", 0, 60], ["whiten", "Trắng nền", 0, 80], ["removeShadow", "Xóa bóng", 0, 80], ["sharpen", "Sắc nét", 0, 60]] as const).map(([key, label, min, max]) => <label key={key}><span>{label}<output>{active.settings[key]}</output></span><input type="range" min={min} max={max} value={active.settings[key]} disabled={active.settings.filter === "original"} onChange={(e) => updateSetting(key, Number(e.target.value))} /></label>)}</div>
              </div>

              <div className="control-actions">
                <button className="reset" onClick={() => updateActive({ settings: { ...defaultSettings }, fineRotation: 0, dewarp: true })}>Đặt lại</button>
                <button className="reset" onClick={applyToAll}>Áp dụng mọi trang</button>
              </div>
            </div>

            <div className="export-box">
              <div><strong>{exportOptions.format === "docx" ? "Sẵn sàng chuyển Word" : "Sẵn sàng xuất"}</strong><span>{pages.length} trang · {exportOptions.format === "docx" ? (exportOptions.wordMode === "editable" ? "Dễ chỉnh sửa" : "Gần bố cục gốc") : (exportOptions.pageSize === "fit" ? "Vừa ảnh" : exportOptions.pageSize.toUpperCase())}</span></div>
              <button className="button primary export" onClick={() => setExportOpen(true)} disabled={busy}>
                {exporting ? <><span className="spinner light" /> Đang xử lý {progress}%</> : <><Download size={18} /> Tùy chọn &amp; tải {exportOptions.format === "docx" ? "Word" : "PDF"}</>}
              </button>
              {exporting && <><div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ transform: `scaleX(${progress / 100})` }} /></div><button className="cancel-export" onClick={cancelExport}>Hủy xuất</button></>}
              {!exporting && lastExport && canShare && <button className="button secondary share-export" onClick={() => void shareLast()}><Share2 size={16} /> Chia sẻ file vừa tạo</button>}
            </div>
          </aside>
        </section>
      )}

      {pages.length > 0 && <ExportGuide />}
      <ExportDialog open={exportOpen} pageCount={pages.length} textLayerPages={textLayerPages} options={exportOptions} onChange={setExportOptions} onClose={() => setExportOpen(false)} onExport={() => void runExport()} />
      <PageRangeDialog request={rangeRequest} onResolve={(range) => { rangeResolver.current?.(range); rangeResolver.current = null; setRangeRequest(null); }} />
      <OcrReviewDialog
        pages={reviewPages}
        onConfirm={(corrections) => { reviewResolver.current?.(corrections); reviewResolver.current = null; setReviewPages(null); }}
        onCancel={() => { reviewResolver.current?.(null); reviewResolver.current = null; setReviewPages(null); }}
      />
      <p className="live-message" aria-live="polite">{message}</p>

      <HomeGuide />
      <AppFooter />
      <DonateWidget inWorkbench={pages.length > 0} />
    </main>
  );
}
