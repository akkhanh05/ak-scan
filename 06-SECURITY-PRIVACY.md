# Bảo mật và quyền riêng tư

## 1. Mô hình dữ liệu

AK Scan hiện không có backend, database, tài khoản hay API upload. Ảnh, PDF, OCR text và file đầu ra nằm trong bộ nhớ/trình duyệt của người dùng. Ứng dụng không gửi nội dung tài liệu đến máy chủ AK Scan.

Website vẫn cần tải JavaScript, PDF worker và có thể tải model ngôn ngữ OCR. Những request này không chứa tài liệu người dùng.

## 2. Kiểm tra input

`lib/upload-security.ts` không tin `file.type` hoặc phần mở rộng. Hệ thống đọc magic bytes để nhận dạng JPEG, PNG, WebP và PDF.

Giới hạn hiện tại:

- 15 MB mỗi ảnh.
- 24 MP mỗi ảnh.
- 40 MB mỗi PDF.
- 20 trang mỗi phiên.
- 160 triệu decoded pixel mỗi phiên.
- 15 giây decode ảnh; 30 giây mở hoặc render trang PDF.

File sai định dạng, giả extension, rỗng, decode lỗi hoặc vượt quota bị từ chối trước pipeline chính.

## 3. PDF an toàn

PDF.js chạy parser trong worker nội bộ `pdf.worker.min.mjs`. Chỉ nội dung raster và text items được dùng; JavaScript action hoặc form action trong PDF không được thực thi bởi ứng dụng. Trang render lỗi hoặc timeout sẽ được dọn dẹp và Blob URL đã tạo được thu hồi.

## 4. Text và DOCX

Filename hiển thị bị loại control character và giới hạn 160 ký tự. Embedded PDF text và OCR text bị loại null byte, XML-invalid control character và lone surrogate trước khi đưa vào thư viện docx. Tên file download do ứng dụng tạo, không dùng path từ filename đầu vào.

## 5. Quản lý Blob URL

Blob URL chỉ có hiệu lực trong origin/session hiện tại. Chúng được theo dõi trong một `Set` và revoke khi xóa trang, xóa phiên, gặp lỗi import hoặc component unmount. Đóng tab/tải lại trang cũng làm mất state phiên.

## 6. HTTP security headers

Khi chạy bằng Next.js server, `next.config.ts` cấu hình:

- Content-Security-Policy.
- `X-Frame-Options: DENY` và `frame-ancestors 'none'`.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: no-referrer`.
- Permissions Policy.
- Cross-Origin-Opener-Policy.
- HSTS trong production.
- SRI SHA-384 cho bundle do Next.js sinh.

GitHub Pages là static hosting và không hỗ trợ `headers()` của Next.js. Workflow vẫn dùng HTTPS và SRI bundle, nhưng các custom response header trên không được áp dụng. Nếu cần policy đầy đủ, deploy qua hosting hỗ trợ header như Vercel, Cloudflare Pages hoặc server riêng.

### CSP source of truth and GitHub Pages

`workflow/shared/core/security-policy.ts` is the single source of truth for CSP. Next.js server deployments use it to set the complete response-header CSP, including `frame-ancestors 'none'`; the static export uses the same baseline directives through a meta tag. `frame-ancestors` is deliberately excluded from the meta-tag form because browsers enforce it only in an HTTP response header.

GitHub Pages provides HTTPS but cannot add custom response headers to this static export. It therefore cannot enforce HSTS, `X-Frame-Options`, `X-Content-Type-Options`, Referrer Policy, Permissions Policy, COOP, or `frame-ancestors`. Deploy to a host with header configuration when those controls are required.

## 7. Dependency và supply chain

- `package-lock.json` phải được commit và CI dùng `npm ci`.
- Có script `npm run security:audit` với ngưỡng high.
- PDF worker được pin theo dependency đã cài và commit trong `public`.
- Workflow GitHub Pages dùng action chính thức với version major cố định.

## 8. Quyền riêng tư thực tế

Ứng dụng không thu analytics và không có error-reporting service. Nếu sau này thêm analytics/Sentry, tuyệt đối không gửi OCR text, filename, Blob URL, canvas pixel hoặc nội dung exception có payload tài liệu.

Trên máy dùng chung, người dùng phải xóa phiên, đóng tab và bảo vệ thư mục Downloads. AK Scan không thể xóa file kết quả sau khi trình duyệt đã tải xuống.

## 9. Rủi ro còn lại

- Extension trình duyệt độc hại có thể đọc DOM/Blob URL theo quyền extension.
- Main-thread image processing có thể làm UI đứng trên thiết bị yếu.
- Cancel chỉ được kiểm tra giữa các trang, không dừng tức thì kernel Canvas đang chạy.
- OCR tải model từ nguồn runtime của Tesseract nếu chưa tự host.
- Kết quả OCR/scan có thể sai; đây là rủi ro toàn vẹn nghiệp vụ, không phải bằng chứng pháp lý.
