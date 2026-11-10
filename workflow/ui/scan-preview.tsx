"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { Corners, ScanPage } from "@/workflow/shared/core/scan";
import { renderPage } from "@/workflow/shared/core/scan";

const cornerNames = ["trên trái", "trên phải", "dưới phải", "dưới trái"];

export function ScanPreview({ page, editing, showOriginal, onCornersChange }: { page: ScanPage; editing: boolean; showOriginal: boolean; onCornersChange: (corners: Corners) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  
  // Exclude page.corners from renderKey when editing/showOriginal to prevent canvas redraw & layout jitter on corner drag
  const renderKey = editing || showOriginal
    ? `${page.id}:${page.url}:mode:${editing ? "edit" : "orig"}`
    : `${page.id}:${page.rotation}:${page.fineRotation ?? 0}:${page.dewarp ? 1 : 0}:${JSON.stringify(page.corners)}:${JSON.stringify(page.settings)}`;
    
  const [result, setResult] = useState({ key: "", error: "" });
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(0.5);
  const [fitSize, setFitSize] = useState({ width: 0, height: 0 });
  const loading = result.key !== renderKey;
  const error = result.key === renderKey ? result.error : "";

  useEffect(() => {
    let live = true;
    const task = editing || showOriginal ? new Promise<HTMLCanvasElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
        const raw = document.createElement("canvas");
        raw.width = Math.round(image.naturalWidth * scale); raw.height = Math.round(image.naturalHeight * scale);
        raw.getContext("2d")?.drawImage(image, 0, 0, raw.width, raw.height); resolve(raw);
      };
      image.onerror = () => reject(new Error("Không thể đọc ảnh này.")); image.src = page.url;
    }) : renderPage(page, 1600);
    task.then((rendered) => {
      if (!live || !canvasRef.current) return;
      const canvas = canvasRef.current;
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      canvas.getContext("2d")?.drawImage(rendered, 0, 0);
      setResult({ key: renderKey, error: "" });
    }).catch((err: Error) => { if (live) setResult({ key: renderKey, error: err.message }); });
    return () => { live = false; };
  }, [page, editing, renderKey, showOriginal]);

  const updateFitSize = useCallback(() => {
    const canvas = canvasRef.current;
    const scrollArea = scrollAreaRef.current;
    if (!canvas?.width || !canvas.height || !scrollArea) return;
    const styles = getComputedStyle(scrollArea);
    const availableWidth = Math.max(1, scrollArea.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight));
    const availableHeight = Math.max(1, scrollArea.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom));
    const scale = Math.min(1, availableWidth / canvas.width, availableHeight / canvas.height);
    setFitSize({ width: Math.max(1, canvas.width * scale), height: Math.max(1, canvas.height * scale) });
  }, []);

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;
    updateFitSize();
    const observer = new ResizeObserver(updateFitSize);
    observer.observe(scrollArea);
    return () => observer.disconnect();
  }, [result.key, updateFitSize]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const updateMinZoom = () => {
      const nextMinZoom = media.matches ? 1 : 0.5;
      setMinZoom(nextMinZoom);
      setZoom((current) => Math.max(nextMinZoom, current));
    };
    updateMinZoom();
    media.addEventListener("change", updateMinZoom);
    return () => media.removeEventListener("change", updateMinZoom);
  }, []);

  function zoomIn() {
    setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100));
  }

  function zoomOut() {
    setZoom((z) => Math.max(minZoom, Math.round((z - 0.25) * 100) / 100));
  }

  function resetZoom() {
    setZoom(1);
  }

  function setCorner(index: number, x: number, y: number) {
    const next = page.corners.map((point) => ({ ...point })) as Corners;
    const pad = .005;
    next[index] = { x: Math.max(pad, Math.min(1 - pad, x)), y: Math.max(pad, Math.min(1 - pad, y)) };
    onCornersChange(next);
  }

  function moveFromPointer(index: number, clientX: number, clientY: number) {
    const rect = documentRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCorner(index, (clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height);
  }

  return (
    <div
      className="preview-stage"
      aria-busy={loading}
      onWheel={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (e.deltaY < 0) zoomIn();
          else zoomOut();
        }
      }}
    >
      {loading && <div className="preview-status"><span className="spinner" />Đang dựng bản scan…</div>}
      {error && <div className="preview-error" role="alert">{error}</div>}

      <div ref={scrollAreaRef} className="preview-scroll-area" tabIndex={0} aria-label="Vùng tài liệu tự co vừa khung và có thể cuộn khi phóng to">
        <div className="preview-zoom-sizer" style={{ width: fitSize.width ? fitSize.width * zoom : undefined, height: fitSize.height ? fitSize.height * zoom : undefined }}>
          <div
            className="preview-document"
            ref={documentRef}
            style={{ width: fitSize.width || undefined, height: fitSize.height || undefined, transform: `scale(${zoom})` }}
          >
          <canvas ref={canvasRef} role="img" aria-label={editing ? `Ảnh gốc để chỉnh bốn góc: ${page.name}` : `Bản xem trước ${page.name}`}>Trình duyệt không hỗ trợ Canvas.</canvas>
          {editing && <>
          <svg className="crop-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={page.corners.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} /></svg>
          {page.corners.map((point, index) => (
            <button
              key={index}
              className="corner-handle"
              style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
              aria-label={`Chỉnh góc ${cornerNames[index]}`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                moveFromPointer(index, event.clientX, event.clientY);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  moveFromPointer(index, event.clientX, event.clientY);
                }
              }}
              onKeyDown={(event) => {
                const step = event.shiftKey ? .02 : .004; let { x, y } = point;
                if (event.key === "ArrowLeft") x -= step; else if (event.key === "ArrowRight") x += step; else if (event.key === "ArrowUp") y -= step; else if (event.key === "ArrowDown") y += step; else return;
                event.preventDefault(); setCorner(index, x, y);
              }}
            >
              <span>{index + 1}</span>
            </button>
          ))}
          </>}
          </div>
        </div>
      </div>

      {/* Floating Zoom Controls Bar with Interactive Slider */}
      <div className="zoom-controls-bar" aria-label="Bộ điều khiển thu phóng">
        <button className="zoom-btn" onClick={zoomOut} disabled={zoom <= minZoom} title="Thu nhỏ (-25%)" aria-label="Thu nhỏ">
          <ZoomOut size={14} />
        </button>

        <input
          type="range"
          min={minZoom * 100}
          max={300}
          step={5}
          value={Math.round(zoom * 100)}
          onChange={(e) => setZoom(Number(e.target.value) / 100)}
          className="zoom-slider-input"
          title={`Thu phóng: ${Math.round(zoom * 100)}%`}
          aria-label="Thanh kéo thu phóng ảnh"
        />

        <button className="zoom-btn" onClick={zoomIn} disabled={zoom >= 3} title="Phóng to (+25%)" aria-label="Phóng to">
          <ZoomIn size={14} />
        </button>

        <button className="zoom-value-btn" onClick={resetZoom} title="100% = vừa toàn bộ tài liệu trong khung xem">
          {Math.round(zoom * 100)}%
        </button>

        <button className="zoom-btn reset-fit" onClick={resetZoom} title="Hiển thị vừa toàn bộ tài liệu" aria-label="Vừa toàn bộ tài liệu">
          <Maximize2 size={13} />
        </button>
      </div>

      <span aria-hidden="true" className="preview-corner top-left" /><span aria-hidden="true" className="preview-corner top-right" />
      <span aria-hidden="true" className="preview-corner bottom-left" /><span aria-hidden="true" className="preview-corner bottom-right" />
    </div>
  );
}

