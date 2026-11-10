# Kiến trúc AK Scan

> Cập nhật theo source hiện tại. AK Scan là ứng dụng Next.js xử lý tài liệu hoàn toàn trong trình duyệt: không có API upload, database hay backend xử lý ảnh.

## 1. Tổng quan

```text
Ảnh / PDF trên máy người dùng
        │  magic bytes, kích thước từ header, quota trang/pixel
        ▼
import-adapter ─┬─ Ảnh  → Blob URL (+ tự dò mép, đánh giá chất lượng trong Worker)
                └─ PDF  → PDF.js: ảnh trang PNG + lớp chữ + đường kẻ/ô màu/ảnh (operator list)
        │
        ▼
Render Worker (OffscreenCanvas): cắt → nắn phối cảnh → (ảnh chụp) làm phẳng + cân thẳng → xoay → lọc
        │                                   (tự chuyển về luồng chính nếu trình duyệt không hỗ trợ)
        ▼
export-pipeline ──┬─ PDF scan ─────────────────────────────→ pdf-lib (JPEG / ảnh 1-bit)
                  ├─ PDF tìm kiếm ─ lớp chữ PDF hoặc OCR ──→ pdf-lib + chữ vô hình (Tr 3)
                  └─ Word ── text layer → bố cục (bảng từ đường kẻ, ô gộp, màu nền, font)
                             OCR → dòng có vị trí → đoạn/heading/danh sách/bảng → docx
                                   │
                         (tùy chọn) bước xem & sửa chữ cạnh ảnh từng dòng
```

Next.js chỉ phục vụ HTML/CSS/JS và tài nguyên tĩnh. Sau khi trang tải, file người dùng không rời khỏi trình duyệt; bộ nhận diện chữ, mô hình ngôn ngữ, PDF worker và font đều được tải từ cùng origin.

## 2. Công nghệ

- Next.js 16 App Router (static export cho GitHub Pages/Cloudflare/Vercel), React 19, TypeScript.
- Canvas / OffscreenCanvas trong Web Worker cho toàn bộ xử lý pixel (`render.worker.ts`, bundle bằng esbuild).
- PDF.js (`pdfjs-dist`) đọc lớp chữ, hình vẽ (đường kẻ bảng, ô tô màu, vị trí ảnh) và render trang.
- Tesseract.js 7 (WASM, LSTM) với mô hình `Vietnamese` (script, best_int) + `eng` (best_int), đóng gói trong `public/tessdata`.
- pdf-lib cho mọi file PDF xuất ra; `docx` cho Word.
- dnd-kit để sắp xếp trang; Lucide React cho icon.
- Playwright (Chrome hệ thống) cho kiểm thử end-to-end trên bản build thật.

## 3. Cấu trúc source

```text
app/
  layout.tsx, page.tsx, globals.css   Metadata, CSP meta, viewport/theme, đăng ký service worker
workflow/
  index.ts                             Ranh giới 3 workflow
  scan-from-image/core                 Quy tắc tự cắt ảnh chụp khi nhập
  scan-from-pdf-images/core            Phân loại trang PDF: "document" (lớp chữ dùng được) / "scan"
  pdf-to-word/core                     Chia trang dùng lớp chữ / trang cần OCR
  shared/core/
    scan.ts                            Pipeline pixel (chạy được ở Worker và luồng chính)
    page-geometry.ts                   Homography, ánh xạ điểm theo cắt/xoay (đặt lớp chữ đúng chỗ)
    render.worker.ts, render-client.ts, render-protocol.ts, render-output.ts
    import-adapter.ts                  Nhập ảnh/PDF có deadline, quota, khoảng trang
    upload-security.ts                 Magic bytes, kích thước từ header, sanitize, timeout
    pdf-document.ts                    Lớp chữ PDF → mô hình tài liệu (bảng, ô gộp, form, đoạn)
    ocr.ts, ocr-structure.ts           Hậu xử lý OCR có bảo toàn nội dung, dựng đoạn/bảng
    ocr-engine.ts, ocr-config.ts       Vòng đời worker Tesseract, mô hình, phiên bản cache
    export-options.ts                  Ý nghĩa thống nhất của khổ giấy/lề/chất lượng
    export-pipeline.ts                 Điều phối render → OCR → bố cục → xuất (tiêm phụ thuộc)
    export/word.ts, export/pdf.ts      Bộ xuất DOCX và PDF thuần
    document-model.ts                  Mô hình tài liệu dùng chung
    draft-store.ts                     Lưu nháp tùy chọn trong IndexedDB
    security-policy.ts                 Nguồn duy nhất của CSP và security headers
  ui/                                  Workspace, preview (kính lúp), dialog xuất, duyệt chữ, khoảng trang
  scripts/                             Test, fixture tổng hợp, sync asset, postbuild, header cho host
public/
  tessdata/                            Mô hình OCR (pin checksum trong workflow/ocr-models.json)
  sw.js, site.webmanifest, icon-*.png  PWA/offline
  _headers                             Header cho Cloudflare Pages/Netlify (sinh từ security-policy)
vercel.json                            Header cho Vercel (sinh từ security-policy)
e2e/                                   Playwright end-to-end
```

Tài nguyên sinh lúc build (không commit): `public/tesseract-worker.min.js`, `public/tesseract-core/*-lstm.wasm.js`, `public/pdf.worker.min.mjs`, `public/render-worker.js` — tạo bởi `workflow/scripts/sync-runtime-assets.mjs` (chạy tự động trước `dev` và `build`) từ đúng phiên bản trong lockfile.

## 4. Trạng thái phiên

`ScanWorkspace` giữ tối đa 20 `ScanPage` trong lịch sử undo/redo (`use-page-history.ts`, 40 bước). Mỗi trang có Blob URL, rotation, fine rotation, dewarp, bốn góc chuẩn hóa, filter settings, cảnh báo chất lượng và — với trang PDF — `pdfPage` (kích thước, text items có font/đậm/nghiêng, đường kẻ, ô màu, vị trí ảnh).

Blob URL còn sống khi bất kỳ bước lịch sử nào còn tham chiếu, và được thu hồi khi không thể quay lại nữa (xóa phiên, hết lịch sử, unmount). Mặc định không lưu gì; nếu người dùng bật **Lưu nháp trên máy**, phiên được lưu vào IndexedDB của trình duyệt đó (có nút xóa).

## 5. Luồng nhập

- **Ảnh:** magic bytes → giới hạn 15 MB → đọc kích thước từ header (JPEG SOF, PNG IHDR, WebP VP8/VP8L/VP8X) và từ chối trên 24 MP **trước khi giải mã** → giải mã kiểm tra (EXIF orientation) → tự dò mép và đánh giá chất lượng trong Worker.
- **PDF:** magic bytes, 40 MB, mở với deadline 30 giây; PDF có mật khẩu/hỏng được báo rõ. Nếu số trang vượt chỗ còn lại, người dùng chọn khoảng trang. Mỗi trang: kiểm tra quota pixel trước khi render, render PNG lossless, đọc lớp chữ + operator list, phân loại document/scan. Mọi bước có deadline.
- Quota pixel của phiên: 160 triệu (máy báo ≤4 GB RAM: 80 triệu; ≤2 GB: 40 triệu).

## 6. Triển khai

- `npm run build` với `STATIC_EXPORT=true` (hoặc trong GitHub Actions) tạo `out/`. `postbuild` kiểm tra đủ mô hình/worker/font (checksum) và thay `'unsafe-inline'` của script trong CSP meta bằng hash các script inline.
- GitHub Pages: base path tự suy từ tên repo. Cloudflare Pages: `STATIC_EXPORT=true`, thư mục `out`, `_headers` có sẵn. Vercel: dùng `vercel.json` (static export hoặc Next server; server dùng `headers()` trong `next.config.ts`). `BASE_PATH` ghi đè base path khi cần.

## 7. Giới hạn kiến trúc

- Render PDF.js vẫn vẽ trên luồng chính (parser chạy trong worker riêng).
- OCR song song tối đa 2 worker trên máy mạnh (≥8 GB RAM, ≥8 nhân), còn lại 1 worker.
- Dựng lại bố cục Word là gần đúng: bảng có đường kẻ, ô gộp, màu nền, font và chữ đậm được giữ; văn bản nhiều cột phức tạp, chữ xoay và hình vẽ vector không được tái tạo.
- Không có tài khoản/đồng bộ; lưu nháp chỉ nằm trong trình duyệt hiện tại.
