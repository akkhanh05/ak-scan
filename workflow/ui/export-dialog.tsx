"use client";

import { useEffect, useRef } from "react";
import { FileDown, X } from "lucide-react";
import type { ExportOptions } from "@/workflow/shared/core/export-options";

export type { ExportOptions } from "@/workflow/shared/core/export-options";

type Choice<T extends string> = readonly (readonly [T, string, string])[];

function Choices<T extends string>({ legend, name, value, choices, columns, onChange }: { legend: string; name: string; value: T; choices: Choice<T>; columns: "one" | "two" | "three"; onChange: (value: T) => void }) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className={`choice-grid ${columns}`}>
        {choices.map(([choice, label, note]) => (
          <label key={choice} className={value === choice ? "selected" : ""}>
            <input type="radio" name={name} value={choice} checked={value === choice} onChange={() => onChange(choice)} />
            <strong>{label}</strong><span>{note}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ExportDialog({ open, pageCount, textLayerPages, options, onChange, onClose, onExport }: {
  open: boolean;
  pageCount: number;
  /** Pages whose own PDF text layer will be used (no OCR). */
  textLayerPages: number;
  options: ExportOptions;
  onChange: (options: ExportOptions) => void;
  onClose: () => void;
  onExport: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const isWord = options.format === "docx";
  const ocrPages = isWord || options.searchable ? pageCount - textLayerPages : 0;
  const set = <K extends keyof ExportOptions>(key: K) => (value: ExportOptions[K]) => onChange({ ...options, [key]: value });

  return <dialog ref={ref} className="export-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === ref.current) onClose(); }} aria-labelledby="export-title">
    <div className="dialog-head"><div className="dialog-icon"><FileDown size={20} /></div><div><h2 id="export-title">{isWord ? "Tạo file Word" : "Tạo file PDF"}</h2><p>{pageCount} trang được xử lý trên thiết bị này{ocrPages > 0 ? ` · ${ocrPages} trang cần nhận diện chữ` : ""}{textLayerPages > 0 && (isWord || options.searchable) ? ` · ${textLayerPages} trang dùng lớp chữ có sẵn` : ""}.</p></div><button onClick={onClose} aria-label="Đóng tùy chọn xuất"><X size={19} /></button></div>
    <div className="dialog-body">
      <div className="dialog-column page-options">
        <Choices legend="Định dạng đầu ra" name="export-format" columns="two" value={options.format} onChange={set("format")} choices={[["pdf", "PDF", "Để gửi, lưu trữ hoặc in"], ["docx", "Word chỉnh sửa", "Đoạn văn, heading, danh sách, bảng"]]} />
        <Choices legend="Khổ giấy" name="page-size" columns="three" value={options.pageSize} onChange={set("pageSize")} choices={[["a4", "A4", "210 × 297 mm"], ["letter", "Letter", "216 × 279 mm"], ["fit", isWord ? "Như bản gốc" : "Vừa ảnh", isWord ? "Theo khổ trang nguồn" : "Theo tỷ lệ ảnh"]]} />
        {!isWord && <Choices legend="Chất lượng ảnh" name="quality" columns="three" value={options.quality} onChange={set("quality")} choices={[["compact", "Gọn", "File nhẹ"], ["balanced", "Cân bằng", "Khuyên dùng"], ["high", "Cao", "Chữ nhỏ rõ hơn"]]} />}
      </div>
      <div className="dialog-column ocr-options">
        <fieldset className="margin-fieldset"><legend>Lề trang</legend><div className="margin-choice-grid">{([ ["none", "Không lề", "Nội dung sát mép giấy"], ["small", "Lề nhỏ", "8 mm · Khuyên dùng"], ["large", "Lề rộng", "15 mm · Dễ ghi chú"] ] as const).map(([value, label, note]) => <label key={value} className={`margin-choice margin-${value} ${options.margin === value ? "selected" : ""}`}><input type="radio" name="margin" value={value} checked={options.margin === value} onChange={() => onChange({ ...options, margin: value })} /><span className="margin-preview" aria-hidden="true"><i /></span><span className="margin-copy"><strong>{label}</strong><small>{note}</small></span></label>)}</div></fieldset>
        {isWord && <Choices legend="Ưu tiên bản Word" name="word-mode" columns="one" value={options.wordMode} onChange={set("wordMode")} choices={[["editable", "Dễ chỉnh sửa", "Văn bản chảy tự nhiên, bảng vừa trang"], ["preserve-layout", "Gần bố cục gốc", "Giữ vị trí lề, khoảng cách và ảnh tương đối; vẫn sửa được"]]} />}
        {!isWord && <fieldset><legend>Nhận diện văn bản</legend><div className="choice-grid one"><label className={options.searchable ? "selected" : ""}><input type="checkbox" checked={options.searchable} onChange={(event) => onChange({ ...options, searchable: event.target.checked })} /><strong>PDF có thể tìm kiếm</strong><span>Thêm lớp chữ ẩn để tìm, bôi chọn và sao chép</span></label></div></fieldset>}
        {ocrPages > 0 && <>
          <Choices legend="Bố cục văn bản (nhận diện chữ)" name="ocr-layout" columns="three" value={options.ocrLayout} onChange={set("ocrLayout")} choices={[["auto", "Tự động", "Nhận cả nhiều cột"], ["single-column", "Một cột", "Hợp đồng, bài viết"], ["sparse", "Rải rác", "Biểu mẫu, hóa đơn"]]} />
          <fieldset><legend>Kiểm tra</legend><div className="choice-grid one"><label className={options.reviewText ? "selected" : ""}><input type="checkbox" checked={options.reviewText} onChange={(event) => onChange({ ...options, reviewText: event.target.checked })} /><strong>Xem và sửa chữ trước khi tạo file</strong><span>Đặt từng dòng cạnh ảnh gốc; dòng chưa chắc chắn được tô vàng</span></label></div></fieldset>
        </>}
        <p className="ocr-confidence-note" role="note">{isWord
          ? "PDF có lớp chữ được dựng lại trực tiếp (bảng, ô gộp, màu nền, font gốc). Trang ảnh được nhận diện bằng mô hình tiếng Việt + Anh trên thiết bị. Hãy đối chiếu số liệu quan trọng với bản gốc."
          : "Ảnh phẳng, đủ sáng và bốn góc được căn chuẩn sẽ cho bản scan rõ và chữ nhận diện chính xác hơn."}</p>
      </div>
    </div>
    <div className="dialog-actions"><button className="button secondary" onClick={onClose}>Quay lại chỉnh</button><button className="button primary" onClick={onExport}><FileDown size={18} /> Tạo {isWord ? "Word" : "PDF"}</button></div>
  </dialog>;
}
