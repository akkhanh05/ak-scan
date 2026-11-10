"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, CheckCircle2, ScanText, X } from "lucide-react";
import type { PageOcr } from "@/workflow/shared/core/export-pipeline";

export interface ReviewPage { pageNumber: number; ocr: PageOcr; imageUrl?: string }

const PREVIEW_HEIGHT = 34;

function isUncertain(line: PageOcr["lines"][number]) {
  return line.flaggedWords > 0 || line.confidence < 82;
}

/**
 * Shows every recognised line next to the image of that line so uncertain
 * text (numbers, names, amounts) can be confirmed before the file is built.
 */
export function OcrReviewDialog({ pages, onConfirm, onCancel }: { pages: ReviewPage[] | null; onConfirm: (corrections: Map<string, string[]>) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [edits, setEdits] = useState<Map<string, string[]>>(new Map());
  const [onlyUncertain, setOnlyUncertain] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (pages && !dialog.open) {
      setEdits(new Map(pages.map((page) => [page.ocr.pageId, page.ocr.lines.map((line) => line.text)])));
      setOnlyUncertain(false);
      dialog.showModal();
    }
    if (!pages && dialog.open) dialog.close();
  }, [pages]);

  const uncertainCount = useMemo(() => pages?.reduce((sum, page) => sum + page.ocr.lines.filter(isUncertain).length, 0) ?? 0, [pages]);
  const lineCount = useMemo(() => pages?.reduce((sum, page) => sum + page.ocr.lines.length, 0) ?? 0, [pages]);

  function focusNextUncertain() {
    const inputs = Array.from(bodyRef.current?.querySelectorAll<HTMLInputElement>("input[data-uncertain='true']") ?? []);
    const current = inputs.findIndex((input) => input === document.activeElement);
    const next = inputs[(current + 1) % Math.max(1, inputs.length)];
    next?.focus();
    next?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return (
    <dialog ref={ref} className="export-dialog review-dialog" aria-labelledby="review-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      {pages && <>
        <div className="dialog-head">
          <div className="dialog-icon"><ScanText size={20} /></div>
          <div>
            <h2 id="review-title">Kiểm tra chữ đã nhận diện</h2>
            <p>{lineCount} dòng · {uncertainCount ? <><strong>{uncertainCount}</strong> dòng chưa chắc chắn được tô vàng</> : "không có dòng nào bị đánh dấu"}. Sửa trực tiếp nếu chữ khác với ảnh.</p>
          </div>
          <button onClick={onCancel} aria-label="Hủy và quay lại chỉnh"><X size={19} /></button>
        </div>
        <div className="review-toolbar">
          <label className="review-filter"><input type="checkbox" checked={onlyUncertain} onChange={(event) => setOnlyUncertain(event.target.checked)} /> Chỉ hiện dòng chưa chắc chắn</label>
          {uncertainCount > 0 && <button className="button secondary small" onClick={focusNextUncertain}><ArrowDown size={15} /> Dòng cần kiểm tra tiếp theo</button>}
        </div>
        <div className="review-body" ref={bodyRef}>
          {pages.map((page) => (
            <section key={page.ocr.pageId} className="review-page" aria-label={`Trang ${page.pageNumber}`}>
              <h3>Trang {page.pageNumber}</h3>
              {!page.ocr.lines.length && <p className="review-empty">Không tìm thấy chữ trên trang này.</p>}
              <ol>
                {page.ocr.lines.map((line, index) => {
                  const uncertain = isUncertain(line);
                  if (onlyUncertain && !uncertain) return null;
                  const lineHeight = Math.max(1, line.bbox.y1 - line.bbox.y0 + 8);
                  const scale = PREVIEW_HEIGHT / lineHeight;
                  const value = edits.get(page.ocr.pageId)?.[index] ?? line.text;
                  return (
                    <li key={index} className={uncertain ? "uncertain" : undefined}>
                      {page.imageUrl && (
                        <div
                          className="review-crop"
                          aria-hidden="true"
                          style={{
                            width: Math.min(560, (line.bbox.x1 - line.bbox.x0 + 8) * scale),
                            height: PREVIEW_HEIGHT,
                            backgroundImage: `url(${page.imageUrl})`,
                            backgroundSize: `${page.ocr.width * scale}px ${page.ocr.height * scale}px`,
                            backgroundPosition: `${-(line.bbox.x0 - 4) * scale}px ${-(line.bbox.y0 - 4) * scale}px`,
                          }}
                        />
                      )}
                      <div className="review-line">
                        {uncertain ? <AlertTriangle size={14} aria-label="Chưa chắc chắn" /> : <CheckCircle2 size={14} aria-hidden="true" />}
                        <input
                          data-uncertain={uncertain}
                          aria-label={`Trang ${page.pageNumber}, dòng ${index + 1}${uncertain ? ", chưa chắc chắn" : ""}`}
                          value={value}
                          spellCheck
                          lang="vi"
                          onChange={(event) => setEdits((current) => {
                            const next = new Map(current);
                            const lines = [...(next.get(page.ocr.pageId) ?? page.ocr.lines.map((item) => item.text))];
                            lines[index] = event.target.value;
                            next.set(page.ocr.pageId, lines);
                            return next;
                          })}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="button secondary" onClick={onCancel}>Hủy xuất</button>
          <button className="button primary" onClick={() => onConfirm(edits)}><CheckCircle2 size={18} /> Tạo file với nội dung này</button>
        </div>
      </>}
    </dialog>
  );
}
