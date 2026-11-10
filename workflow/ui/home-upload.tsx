import type { DragEvent, RefObject } from "react";
import { Camera, FileText, LockKeyhole, ScanSearch, Upload } from "lucide-react";

type HomeUploadProps = {
  dragging: boolean;
  importing: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  pdfRef: RefObject<HTMLInputElement | null>;
  cameraRef: RefObject<HTMLInputElement | null>;
  onDraggingChange: (dragging: boolean) => void;
  onFiles: (files: FileList) => void;
};

export function HomeUpload({ dragging, importing, fileRef, pdfRef, cameraRef, onDraggingChange, onFiles }: HomeUploadProps) {
  function resetAndAdd(input: HTMLInputElement) {
    if (input.files) onFiles(input.files);
    input.value = "";
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    onDraggingChange(false);
    onFiles(event.dataTransfer.files);
  }

  return (
    <>
      <section className="hero-section" id="top">
        <div className="hero-badge"><ScanSearch size={14} /><span>CÔNG CỤ TỐI ƯU ẢNH CHỤP TÀI LIỆU</span></div>
        <h1 className="hero-title">Trang trắng hơn. <span className="highlight">Chữ rõ hơn.</span></h1>
        <p className="hero-subtitle">
          AK Scan tự động loại bỏ nền tối, tăng độ tương phản và cân chỉnh ảnh chụp tài liệu,
          tạo ra bản quét rõ nét như từ máy scan chuyên dụng. Hoàn toàn miễn phí và bảo mật.
        </p>
      </section>

      <div className="upload-container" id="workspace">
        <section
          className={`upload-zone-card ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); onDraggingChange(true); }}
          onDragLeave={() => onDraggingChange(false)}
          onDrop={drop}
        >
          <div className="format-floating-tag top-left">.JPG</div>
          <div className="format-floating-tag top-right">.PNG</div>
          <div className="upload-icon-box"><Upload size={32} /></div>
          <h2>Kéo thả ảnh hoặc PDF vào đây</h2>
          <p>Hoặc chọn file từ thiết bị. Hỗ trợ <b>JPG, PNG, WebP, PDF</b>. Tối đa 15 MB/ảnh, 40 MB/PDF, 20 trang mỗi phiên.</p>

          <div className="upload-actions-grid">
            <button className="button primary" disabled={importing} onClick={() => fileRef.current?.click()}><Upload size={18} /><span>Chọn File Ảnh</span></button>
            <button className="button secondary" disabled={importing} onClick={() => pdfRef.current?.click()}><FileText size={18} /><span>{importing ? "Đang mở PDF…" : "Chọn File PDF"}</span></button>
            <button className="button secondary" disabled={importing} onClick={() => cameraRef.current?.click()}><Camera size={18} /><span>Mở Camera</span></button>
          </div>

          <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => resetAndAdd(event.currentTarget)} />
          <input ref={pdfRef} className="sr-only" type="file" accept="application/pdf,.pdf" multiple onChange={(event) => resetAndAdd(event.currentTarget)} />
          <input ref={cameraRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => resetAndAdd(event.currentTarget)} />
        </section>

        <p className="upload-privacy-note" role="note">
          <LockKeyhole size={17} aria-hidden="true" />
          <span><strong>Xử lý cục bộ:</strong> Ảnh và PDF được xử lý trên thiết bị của bạn; AK Scan không tải tài liệu lên máy chủ.</span>
        </p>

        <div className="trust-stats-bar">
          <div className="stat-card"><strong>100%</strong><span>Xử lý cục bộ</span></div>
          <div className="stat-card"><strong>0đ</strong><span>Miễn phí hoàn toàn</span></div>
          <div className="stat-card"><strong>15MB</strong><span>Dung lượng tối đa/ảnh</span></div>
        </div>
      </div>
    </>
  );
}

