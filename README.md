# AK Scan

> Quét ảnh tài liệu, tạo PDF scan và chuyển PDF tài liệu sang Word ngay trên thiết bị.

AK Scan là ứng dụng client-only: ảnh, PDF và nội dung OCR được xử lý trong trình duyệt, không có API upload và không lưu tài liệu lên máy chủ. Bộ nhận diện chữ và mô hình tiếng Việt cũng được phục vụ từ chính trang web, không qua dịch vụ bên thứ ba.

## Ba workflow

1. **Ảnh chụp tài liệu → PDF scan / PDF tìm kiếm / Word**: tự dò mép ngay khi nhập, nắn phối cảnh, làm phẳng giấy cong, làm sạch nền, khử bóng và tăng nét; nhận diện chữ Việt + Anh.
2. **PDF chứa ảnh scan → PDF scan / Word**: tách từng trang rồi chạy cùng pipeline như ảnh chụp (trang là một ảnh lớn kèm lớp OCR cũ cũng được nhận diện lại bằng mô hình tiếng Việt).
3. **PDF tài liệu có lớp chữ → Word chỉnh sửa**: dựng lại trực tiếp từ lớp chữ — bảng từ đường kẻ (kể cả ô gộp, màu nền), font gốc, chữ đậm, đoạn, heading, danh sách, ảnh — không OCR lại.

## Tính năng

- JPG, PNG, WebP, PDF (nhiều file một lần) và camera trên thiết bị tương thích.
- Tự dò mép khi nhập ảnh; chỉnh tay bốn góc có kính lúp, phím mũi tên; hoàn tác/làm lại (Ctrl+Z / Ctrl+Shift+Z).
- Bộ lọc màu gốc, tăng cường, xám, trắng đen; chỉnh sáng, tương phản, trắng nền, khử bóng, sắc nét. Xử lý ảnh chạy trong Web Worker nên giao diện không bị đứng.
- OCR tiếng Việt + Anh bằng mô hình `Vietnamese` + `eng` (best_int) đóng gói sẵn; so sánh nhiều lượt theo từng dòng; **bước xem và sửa chữ** đặt mỗi dòng cạnh ảnh gốc, tô vàng dòng chưa chắc chắn.
- Nguyên tắc toàn vẹn: không tự sửa từ, không xóa chữ số, không gộp dòng lặp hợp lệ (ví dụ hai dòng “Tổng cộng” giống nhau).
- Xuất PDF scan (trang trắng đen lưu ảnh 1-bit rất nhẹ), PDF có thể tìm kiếm (lớp chữ vô hình đúng vị trí) và Word (`vi-VN`, heading/danh sách/bảng thật). Khổ giấy, lề, chất lượng có cùng ý nghĩa ở mọi định dạng.
- PDF dài hơn số chỗ còn lại: chọn khoảng trang cần nhập.
- Tên file xuất theo tên file nguồn; nút chia sẻ (Web Share) trên điện thoại.
- Lưu nháp trên máy (tùy chọn, IndexedDB), PWA cài được và dùng offline sau lần mở đầu, dark mode theo hệ thống.

## Riêng tư và bảo mật

- **Xử lý cục bộ:** không có backend, API upload, database, tài khoản hay cookie đăng nhập. Không có request tới bên thứ ba (test end-to-end kiểm tra điều này).
- **Lưu nháp là tùy chọn và mặc định tắt;** khi bật, dữ liệu chỉ nằm trong IndexedDB của trình duyệt đó và bị xóa khi tắt.
- **Không tin tên file:** nhận dạng bằng magic bytes; kích thước ảnh đọc từ header và ảnh quá lớn bị từ chối trước khi giải mã; tên file bị loại ký tự điều khiển/Bidi.
- **Giới hạn tài nguyên:** 15 MB/ảnh, 24 MP/ảnh, 40 MB/PDF, 20 trang và 160 triệu pixel mỗi phiên (thấp hơn trên máy ít RAM); mọi bước đọc/render/OCR có deadline; hủy xuất dừng thật các worker.
- **Đầu ra an toàn:** text được loại ký tự không hợp lệ trước khi tạo PDF/DOCX.
- **CSP:** script chỉ từ cùng origin, script inline được ghim bằng hash lúc build (không còn `'unsafe-inline'` cho script); header đầy đủ (chống iframe, HSTS, nosniff…) cho Cloudflare Pages (`public/_headers`), Vercel (`vercel.json`) và Next.js server.
- **Chuỗi cung ứng:** `npm audit` mức moderate = 0 lỗ hổng; mô hình OCR ghim checksum; worker/lõi OCR sinh từ lockfile lúc build; GitHub Actions ghim theo SHA; Dependabot hằng tuần.

Chi tiết: [06-SECURITY-PRIVACY.md](06-SECURITY-PRIVACY.md).

## Sử dụng

1. Chọn/kéo ảnh, PDF hoặc mở camera.
2. Kiểm tra vùng giấy (đã tự dò) và chỉnh bốn góc nếu cần.
3. Chọn bộ lọc và tinh chỉnh.
4. Chọn đầu ra: PDF, PDF tìm kiếm hoặc Word; với trang cần nhận diện chữ, kiểm tra từng dòng ở bước xem và sửa.
5. Đối chiếu số liệu quan trọng với bản gốc.

## Chạy local

Yêu cầu Node.js 20+ và npm.

```bash
git clone https://github.com/akkhanh05/ak-scan.git
cd ak-scan
npm ci
npm run dev        # tự sinh worker/lõi OCR/PDF worker vào public/
```

Mở [http://localhost:3000](http://localhost:3000). Khi sửa `workflow/shared/core/scan.ts` hoặc render worker, chạy lại `node workflow/scripts/sync-runtime-assets.mjs` (hoặc khởi động lại `npm run dev`) để bundle lại worker.

## Kiểm tra chất lượng

```bash
npm run lint
npm run typecheck
npm test                                   # gồm OCR thật trên ảnh mẫu
STATIC_EXPORT=true BASE_PATH=/ak-scan npm run build
npm run test:e2e                           # Playwright, dùng Chrome cài trên máy
```

Chi tiết: [08-TEST-PLAN.md](08-TEST-PLAN.md).

## Triển khai

| Host | Thiết lập |
|---|---|
| **Cloudflare Pages** (khuyên dùng) | Build command `npm run build`, biến môi trường `STATIC_EXPORT=true`, output `out`. Header bảo mật lấy từ `public/_headers`. |
| **Vercel** | Framework Next.js; hoặc static export với `STATIC_EXPORT=true`. Header từ `vercel.json` (và `next.config.ts` khi chạy server). |
| **GitHub Pages** | Workflow `.github/workflows/deploy-pages.yml` (Settings → Pages → GitHub Actions). Base path tự suy từ tên repo. Không hỗ trợ header tùy chỉnh. |

Dùng `BASE_PATH=/duong-dan` nếu site không nằm ở gốc tên miền; `NEXT_PUBLIC_SITE_URL` cho URL chính thức (Open Graph). Sau khi sửa `security-policy.ts`, chạy `npm run headers:sync`.

## Giới hạn hiện tại

| Giới hạn | Mức tối đa |
| --- | ---: |
| Số trang mỗi phiên | 20 |
| Dung lượng mỗi ảnh | 15 MB |
| Độ phân giải mỗi ảnh | 24 MP |
| Dung lượng mỗi PDF | 40 MB |
| Tổng pixel mỗi phiên | 160 triệu (80/40 triệu trên máy ≤4/≤2 GB RAM) |

Dựng bố cục Word là gần đúng: bảng có đường kẻ, ô gộp, màu nền, font được giữ; trang nhiều cột phức tạp, chữ xoay và hình vẽ vector không được tái tạo.

## Công nghệ

- Next.js 16, React 19, TypeScript
- Canvas/OffscreenCanvas trong Web Worker (bundle bằng esbuild)
- PDF.js, pdf-lib, docx
- Tesseract.js 7 với mô hình `Vietnamese` + `eng` (best_int) đóng gói sẵn
- Playwright cho kiểm thử end-to-end

## Tài liệu kỹ thuật

- [Kiến trúc hệ thống](02-ARCHITECTURE.md)
- [Pipeline ảnh, OCR và dựng lại tài liệu](05-IMAGE-OCR-PIPELINE.md)
- [Bảo mật và quyền riêng tư](06-SECURITY-PRIVACY.md)
- [Kế hoạch kiểm thử](08-TEST-PLAN.md)

## Tác giả và bản quyền

Phát triển bởi **akkhanh — THE KODENAK**. Dự án được phát hành miễn phí trên GitHub; vui lòng giữ thông tin tác giả khi sử dụng, chỉnh sửa hoặc chia sẻ lại.

Mô hình OCR trong `public/tessdata` thuộc dự án Tesseract OCR, giấy phép Apache-2.0 (nguồn và checksum trong `workflow/ocr-models.json`).

© 2026 akkhanh — THE KODENAK.
