"use client";

import { useEffect, useRef } from "react";
import { FileDown, X } from "lucide-react";

export type PageSize = "a4" | "letter" | "fit";
export type PdfMargin = "none" | "small" | "large";
export type PdfQuality = "compact" | "balanced" | "high";
export type ExportFormat = "pdf" | "docx";
export type OcrLayout = "auto" | "single-column" | "multi-column" | "sparse";
export type WordMode = "editable" | "preserve-layout";
export interface ExportOptions { pageSize: PageSize; margin: PdfMargin; quality: PdfQuality; searchable: boolean; format: ExportFormat; ocrLayout: OcrLayout; wordMode: WordMode; }

export function ExportDialog({ open, pageCount, options, onChange, onClose, onExport }: { open: boolean; pageCount: number; options: ExportOptions; onChange: (options: ExportOptions) => void; onClose: () => void; onExport: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="export-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === ref.current) onClose(); }} aria-labelledby="export-title">
    <div className="dialog-head"><div className="dialog-icon"><FileDown size={20} /></div><div><h2 id="export-title">{options.format === "docx" ? "Chuyển PDF thành Word" : "Xuất PDF scan"}</h2><p>{pageCount} trang sẽ được xử lý trên thiết bị này.</p></div><button onClick={onClose} aria-label="Đóng tùy chọn xuất"><X size={19} /></button></div>
    <div className="dialog-body">
      <div className="dialog-column page-options">
        <fieldset><legend>Định dạng đầu ra</legend><div className="choice-grid two">{([ ["pdf", "PDF", "Để gửi, lưu trữ hoặc in"], ["docx", "Word chỉnh sửa", "Giữ chữ, heading, danh sách và bảng"] ] as const).map(([value, label, note]) => <label key={value} className={options.format === value ? "selected" : ""}><input type="radio" name="export-format" value={value} checked={options.format === value} onChange={() => onChange({ ...options, format: value })} /><strong>{label}</strong><span>{note}</span></label>)}</div></fieldset>
        <fieldset><legend>Khổ trang</legend><div className="choice-grid three">{([ ["a4", "A4", "210 × 297 mm"], ["letter", "Letter", "216 × 279 mm"], ["fit", "Vừa ảnh", "Theo tỷ lệ ảnh"] ] as const).map(([value, label, note]) => <label key={value} className={options.pageSize === value ? "selected" : ""}><input type="radio" name="page-size" value={value} checked={options.pageSize === value} onChange={() => onChange({ ...options, pageSize: value })} /><strong>{label}</strong><span>{note}</span></label>)}</div></fieldset>
        <fieldset><legend>Chất lượng</legend><div className="choice-grid">{([ ["compact", "Gọn", "File nhẹ"], ["balanced", "Cân bằng", "Khuyên dùng"], ["high", "Cao", "Chữ nhỏ rõ hơn"] ] as const).map(([value, label, note]) => <label key={value} className={options.quality === value ? "selected" : ""}><input type="radio" name="quality" value={value} checked={options.quality === value} onChange={() => onChange({ ...options, quality: value })} /><strong>{label}</strong><span>{note}</span></label>)}</div></fieldset>
      </div>
      <div className="dialog-column ocr-options">
        <fieldset className="margin-fieldset"><legend>Lề trang</legend><div className="margin-choice-grid">{([ ["none", "Không lề", "Ảnh phủ sát mép"], ["small", "Lề nhỏ", "8 mm · Khuyên dùng"], ["large", "Lề rộng", "15 mm · Dễ ghi chú"] ] as const).map(([value, label, note]) => <label key={value} className={`margin-choice margin-${value} ${options.margin === value ? "selected" : ""}`}><input type="radio" name="margin" value={value} checked={options.margin === value} onChange={() => onChange({ ...options, margin: value })} /><span className="margin-preview" aria-hidden="true"><i /></span><span className="margin-copy"><strong>{label}</strong><small>{note}</small></span></label>)}</div></fieldset>
        {options.format === "docx" && <fieldset><legend>Ưu tiên bản Word</legend><div className="choice-grid one">{([ ["editable", "Dễ chỉnh sửa", "Tạo đoạn văn, danh sách và bảng Word"], ["preserve-layout", "Giữ bố cục", "Vẫn chỉnh sửa được, ưu tiên vị trí gốc"] ] as const).map(([value, label, note]) => <label key={value} className={options.wordMode === value ? "selected" : ""}><input type="radio" name="word-mode" value={value} checked={options.wordMode === value} onChange={() => onChange({ ...options, wordMode: value })} /><strong>{label}</strong><span>{note}</span></label>)}</div></fieldset>}
        {options.format === "pdf" && <fieldset><legend>Nhận diện văn bản</legend><div className="choice-grid one"><label className={options.searchable ? "selected" : ""}><input type="checkbox" checked={options.searchable} onChange={(event) => onChange({ ...options, searchable: event.target.checked })} /><strong>PDF có thể tìm kiếm</strong><span>Nhận diện văn bản ngay trên thiết bị</span></label></div><p className="ocr-confidence-note" role="note">Ảnh chụp phẳng và bốn góc tài liệu được căn chỉnh chính xác sẽ giúp nhận diện văn bản đạt độ chính xác cao hơn.</p></fieldset>}
        {options.format === "docx" && <p className="ocr-confidence-note" role="note">PDF có chữ rõ sẽ được giữ trực tiếp, không dịch và không tô màu. PDF scan ảnh sẽ được nhận diện thành văn bản sạch. Ảnh phẳng và bốn góc được căn chuẩn sẽ cho kết quả chính xác hơn.</p>}
      </div>
    </div>
    <div className="dialog-actions"><button className="button secondary" onClick={onClose}>Quay lại chỉnh</button><button className="button primary" onClick={onExport}><FileDown size={18} /> Tạo {options.format === "docx" ? "Word" : "PDF"}</button></div>
  </dialog>;
}

