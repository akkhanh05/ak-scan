import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, ChevronLeft, ChevronRight, GripVertical, X } from "lucide-react";
import type { ScanPage } from "@/workflow/shared/core/scan";

type SortablePageProps = {
  page: ScanPage;
  active: boolean;
  index: number;
  last: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onMove: (delta: number) => void;
};

export function SortablePage({ page, active, index, last, onSelect, onDelete, onMove }: SortablePageProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: page.id });

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`page-row ${active ? "active" : ""}`}>
      <button className="drag-handle" aria-label={`Kéo để sắp xếp trang ${index + 1}`} {...attributes} {...listeners}><GripVertical size={17} /></button>
      <button className="page-select" onClick={onSelect} aria-current={active ? "page" : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Blob URL cục bộ không phù hợp với next/image. */}
        <img src={page.url} alt="" />
        <span>
          <strong>Trang {index + 1}</strong>
          <small title={page.qualityWarning ?? page.name}>
            {page.qualityWarning ? <><AlertTriangle size={12} /> {page.qualityWarning}</> : page.name}
          </small>
        </span>
      </button>
      <div className="page-actions">
        <button onClick={() => onMove(-1)} disabled={index === 0} aria-label="Chuyển trang lên"><ChevronLeft size={15} /></button>
        <button onClick={() => onMove(1)} disabled={last} aria-label="Chuyển trang xuống"><ChevronRight size={15} /></button>
        <button onClick={onDelete} aria-label={`Xóa trang ${index + 1}`}><X size={15} /></button>
      </div>
    </li>
  );
}

