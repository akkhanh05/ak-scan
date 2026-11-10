# Bảo mật và quyền riêng tư

## 1. Mô hình dữ liệu

AK Scan không có backend, database, tài khoản hay API upload. Ảnh, PDF, chữ nhận diện và file xuất nằm trong bộ nhớ của trình duyệt. Trang chỉ tải tài nguyên tĩnh từ chính origin của nó — kể cả bộ nhận diện chữ (`tesseract-worker.min.js`, lõi WASM), mô hình ngôn ngữ (`tessdata/*.gz`), PDF worker và font. Không có request nào tới dịch vụ bên thứ ba; test end-to-end thất bại nếu có.

**Lưu nháp (tùy chọn, mặc định tắt):** khi người dùng bật “Lưu nháp trên máy”, ảnh trang và thiết lập được lưu vào IndexedDB của trình duyệt đó để mở lại sau. Dữ liệu không rời khỏi máy; tắt tùy chọn sẽ xóa toàn bộ bản nháp. Trên máy dùng chung không nên bật.

**Service worker:** chỉ cache tài nguyên của ứng dụng (HTML, JS, mô hình, font) để chạy offline; không bao giờ thấy hay cache nội dung tài liệu (file không đi qua mạng).

## 2. Kiểm tra input

`workflow/shared/core/upload-security.ts` và `import-adapter.ts`:

- Không tin `file.type`/phần mở rộng: nhận dạng JPEG/PNG (IHDR)/WebP (RIFF/WEBP)/PDF (`%PDF-1.x`) bằng magic bytes.
- Kích thước ảnh đọc từ header (JPEG SOF, PNG IHDR, WebP VP8/VP8L/VP8X) và ảnh trên 24 MP bị từ chối **trước khi giải mã**.
- Giới hạn: 15 MB/ảnh, 40 MB/PDF, 20 trang/phiên, 160 triệu pixel/phiên (80 triệu nếu máy báo ≤4 GB RAM, 40 triệu nếu ≤2 GB). Quota được kiểm tra **trước** khi render từng trang.
- Deadline: 15 giây giải mã ảnh; 30 giây cho mở PDF, đọc trang, render và đọc nội dung từng trang; OCR có deadline cả lúc tải mô hình (180 giây) và mỗi lần nhận diện (120 giây).
- PDF có mật khẩu hoặc hỏng được báo rõ; XFA tắt.
- Tên file hiển thị: bỏ ký tự điều khiển và ký tự Unicode Bidi/định dạng ẩn, chuẩn hóa NFC, tối đa 160 ký tự. Tên file tải xuống dựa trên tên nguồn nhưng bỏ ký tự không hợp lệ trên mọi hệ điều hành.

## 3. Cô lập xử lý

- Pixel xử lý trong render Worker (OffscreenCanvas); PDF.js parse trong PDF worker; OCR trong worker Tesseract.
- Hủy xuất **dừng thật**: terminate worker OCR (kể cả lúc đang tải mô hình) và render worker; không chỉ bỏ qua kết quả.
- Blob URL được thu hồi khi không còn bước lịch sử nào tham chiếu, khi xóa phiên hoặc khi rời trang.

## 4. Text đầu ra

Text từ PDF/OCR bị loại null byte, ký tự điều khiển không hợp lệ trong XML và lone surrogate trước khi vào DOCX/PDF. React escape mọi nội dung hiển thị; source không dùng `dangerouslySetInnerHTML`, `innerHTML`, `eval` hay `new Function`.

## 5. HTTP headers và CSP

`workflow/shared/core/security-policy.ts` là nguồn duy nhất:

- CSP: `default-src 'self'`, script chỉ `'self'` + `'wasm-unsafe-eval'` (WASM của OCR), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` (chỉ header), `upgrade-insecure-requests`.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (chỉ camera cho chính trang), `Cross-Origin-Opener-Policy: same-origin`, HSTS 2 năm + preload.

Theo nơi triển khai:

| Host | Cách áp dụng |
|---|---|
| Next.js server | `headers()` trong `next.config.ts` |
| Cloudflare Pages / Netlify | `public/_headers` (sinh bằng `npm run headers:sync`) |
| Vercel | `vercel.json` (sinh bằng `npm run headers:sync`) |
| GitHub Pages | Không hỗ trợ header tùy chỉnh; chỉ có CSP qua thẻ meta. GitHub tự cấp HTTPS + HSTS cho `*.github.io`, nhưng không có chống nhúng iframe. |

Static export: `postbuild` thay `'unsafe-inline'` của **script** trong CSP meta bằng hash SHA-256 của đúng các script inline Next.js sinh ra, nên script chèn vào trang không chạy được. Header CSP có thể giữ `'unsafe-inline'` vì trình duyệt áp **cả hai** policy. `style-src` vẫn cần `'unsafe-inline'` cho thuộc tính `style` của React.

Test `test-security.ts` thất bại nếu `_headers`/`vercel.json` lệch khỏi policy, nếu checksum mô hình sai hoặc nếu phiên bản cache mô hình không khớp giữa `ocr-config.ts`, `sw.js` và `ocr-models.json`.

## 6. Chuỗi cung ứng

- `npm ci` từ lockfile; `npm audit --audit-level=moderate` trong CI và `npm run security:audit` (cùng ngưỡng). Hiện 0 lỗ hổng; `minimatch` của typescript-eslint được ghim ≥ 11.0.5 qua `overrides` (GHSA-g3hv-75wg-m249).
- Worker/lõi OCR/PDF worker **sinh lúc build** từ `node_modules` (không commit), nên luôn khớp phiên bản thư viện; render worker bundle bằng esbuild và URL có hash nội dung.
- Mô hình OCR ghim SHA-256 trong `workflow/ocr-models.json`; build thất bại nếu thiếu hoặc sai.
- GitHub Actions ghim theo commit SHA; Dependabot cập nhật npm và actions hằng tuần.
- SRI SHA-384 cho bundle Next.js (experimental).

## 7. Quyền riêng tư thực tế

Không analytics, không error-reporting service. Nếu thêm sau này, tuyệt đối không gửi chữ OCR, tên file, Blob URL, pixel hay nội dung lỗi có payload tài liệu.

## 8. Rủi ro còn lại

- Extension trình duyệt có quyền đọc trang vẫn đọc được DOM/Blob URL.
- File chế tạo đặc biệt vẫn có thể làm chậm thiết bị của chính người mở trong giới hạn quota/deadline; không ảnh hưởng máy chủ.
- Kết quả OCR/dựng bố cục có thể sai; đây là rủi ro toàn vẹn nghiệp vụ — dùng bước “Xem và sửa chữ” và đối chiếu số liệu quan trọng.
- Trên GitHub Pages chưa có chống clickjacking bằng header (ứng dụng không có tài khoản hay thao tác nhạy cảm nên tác động thấp); chuyển sang Cloudflare/Vercel sẽ có đủ header.
