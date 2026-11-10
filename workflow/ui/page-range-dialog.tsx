"use client";
import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";

export interface PageRangeRequest { fileName: string; numPages: number; room: number }

/** Asks which pages of a long PDF to import when it does not fit the session. */
export function PageRangeDialog({ request, onResolve }: { request: PageRangeRequest | null; onResolve: (range: [number, number] | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [start, setStart] = useState(1);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) { setStart(1); dialog.showModal(); }
    if (!request && dialog.open) dialog.close();
  }, [request]);
  if (!request) return <dialog ref={ref} className="export-dialog range-dialog" />;
  const maxStart = Math.max(1, request.numPages - request.room + 1);
  const safeStart = Math.min(Math.max(1, start || 1), maxStart);
  const end = Math.min(request.numPages, safeStart + request.room - 1);
  return (
    <dialog ref={ref} className="export-dialog range-dialog" aria-labelledby="range-title" onCancel={(event) => { event.preventDefault(); onResolve(null); }}>
      <div className="dialog-head">
        <div className="dialog-icon"><FileText size={20} /></div>
        <div><h2 id="range-title">Chọn trang cần nhập</h2><p>{request.fileName} có {request.numPages} trang, phiên còn chỗ cho {request.room} trang.</p></div>
      </div>
      <div className="dialog-body range-body">
        <label className="range-field">
          <span>Bắt đầu từ trang</span>
          <input type="number" inputMode="numeric" min={1} max={maxStart} value={start} onChange={(event) => setStart(Number(event.target.value))} />
        </label>
        <p className="range-summary" role="status">Sẽ nhập trang <strong>{safeStart}–{end}</strong>. {request.numPages - (end - safeStart + 1)} trang còn lại không được nhập; bạn có thể xuất phiên này rồi nhập phần tiếp theo.</p>
      </div>
      <div className="dialog-actions">
        <button className="button secondary" onClick={() => onResolve(null)}>Bỏ qua file này</button>
        <button className="button primary" onClick={() => onResolve([safeStart, end])}>Nhập trang {safeStart}–{end}</button>
      </div>
    </dialog>
  );
}
