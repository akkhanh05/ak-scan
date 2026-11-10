# AK Scan

> Quét ảnh tài liệu, tạo PDF scan và chuyển PDF tài liệu sang Word ngay trên thiết bị.

AK Scan là ứng dụng client-only: ảnh, PDF và nội dung OCR được xử lý trong trình duyệt, không có API upload và không lưu tài liệu lên máy chủ.

## Ba workflow

1. **Ảnh chụp tài liệu → PDF scan**: tự dò bốn góc, nắn phối cảnh, làm sạch nền, khử bóng và tăng nét.
2. **PDF chứa ảnh scan → PDF scan**: tách từng trang rồi chạy cùng pipeline xử lý như ảnh chụp.
3. **PDF tài liệu có lớp chữ → Word chỉnh sửa**: đọc trực tiếp lớp chữ, khôi phục đoạn, heading, danh sách và bảng; không OCR lại khi lớp chữ dùng được.

## Tính năng

- Hỗ trợ JPG, PNG, WebP, PDF và camera trên thiết bị tương thích.
- Căn chỉnh tự động hoặc chỉnh tay bốn góc; hỗ trợ làm phẳng giấy cong.
- Bộ lọc màu gốc, tăng cường, xám và trắng đen; chỉnh sáng, tương phản, trắng nền, khử bóng và sắc nét.
- OCR tiếng Việt và tiếng Anh (`eng+vie`) với nhiều lượt đối chiếu để ưu tiên độ chính xác.
- Xuất PDF scan, PDF có thể tìm kiếm và DOCX chỉnh sửa.
- Giữ bố cục PDF có lớp chữ: đoạn văn, heading, danh sách, bảng và căn đều hai lề.
- Mục lục cố định, giao diện responsive, hỗ trợ thu phóng Firefox bằng `transform: scale()`.
- Favicon, Apple Touch Icon, Web App Manifest, Open Graph/Twitter Card và `robots.txt`.

## Riêng tư và bảo mật

- **Xử lý cục bộ:** không có backend, API upload, database, tài khoản, cookie đăng nhập hoặc kho lưu tài liệu. Ảnh, PDF và OCR chỉ nằm trong bộ nhớ phiên trình duyệt.
- **Không tin tên file:** hệ thống đọc magic bytes và kiểm tra thêm cấu trúc PNG `IHDR`, WebP `RIFF/WEBP` và PDF header có phiên bản; file rỗng, giả extension hoặc không giải mã được bị từ chối.
- **Chống giả mạo tên file:** loại control character, ký tự Unicode Bidi/formatting ẩn, chuẩn hóa Unicode NFC và giới hạn tên hiển thị 160 ký tự.
- **Giới hạn tài nguyên:** tối đa 15 MB/ảnh, 24 MP/ảnh, 40 MB/PDF, 20 trang và 160 triệu decoded pixel mỗi phiên; thao tác đọc/render có timeout và dọn Blob URL khi lỗi hoặc xóa phiên.
- **Đầu ra an toàn:** text OCR/PDF được loại null byte, XML-invalid control character và lone surrogate trước khi tạo PDF/DOCX; tên file tải xuống do ứng dụng sinh, không dùng đường dẫn từ input.
- **Tài nguyên nội bộ:** Tesseract worker, PDF worker, WASM, font và dữ liệu ngôn ngữ được phục vụ cùng origin; bundle production có SRI SHA-384.
- **CSP và HTTPS:** production dùng HTTPS/HSTS; CSP giới hạn script, style, ảnh, font, worker, kết nối, object và form action. CSP vẫn cần `unsafe-inline`/`wasm-unsafe-eval` để Next.js static export và OCR/WASM hoạt động.
- **Không lưu secret phía client:** mã ứng dụng không dùng `localStorage`, `sessionStorage` hay token/API key; kiểm tra source hiện không phát hiện secret được commit.

> AK Scan không tải nội dung tài liệu lên máy chủ. Trình duyệt, extension đã cài và thư mục Downloads vẫn thuộc phạm vi bảo mật của thiết bị người dùng.

### GitHub Pages and security headers

GitHub Pages only serves static files and cannot apply the response headers configured by `next.config.ts`. The exported HTML includes the same baseline CSP through a meta tag, which protects script, style, image, font, connection and worker sources. Browser-enforced framing protection (`frame-ancestors` / `X-Frame-Options`), HSTS, `nosniff`, Referrer Policy, Permissions Policy and COOP require a host that supports response headers such as Cloudflare Pages, Vercel, or a server under your control.

### OWASP Top 10

- **Broken Access Control, Authentication, CSRF, SSRF, SQL/command injection:** hiện không áp dụng vì AK Scan không có server, API, session, tài khoản hoặc database. Nếu kiến trúc này thay đổi, các kiểm soát trên phải được thiết kế và audit lại từ đầu.
- **Injection/XSS:** React escape nội dung theo mặc định; source ứng dụng không dùng `dangerouslySetInnerHTML`, `innerHTML`, `eval` hoặc `new Function`. Text đưa vào tài liệu đầu ra được làm sạch riêng.
- **Security Misconfiguration:** Next.js server đã khai báo CSP, `X-Frame-Options`, `nosniff`, Referrer Policy, Permissions Policy, COOP và HSTS. GitHub Pages không áp dụng custom response headers, nên clickjacking protection đầy đủ cần hosting hỗ trợ header như Cloudflare Pages, Vercel hoặc server riêng.
- **Vulnerable and Outdated Components:** CI chạy `npm audit --audit-level=moderate`; Dependabot theo dõi npm và GitHub Actions hằng tuần.
- **Software and Data Integrity:** dependency cài bằng `npm ci` từ lockfile, production bundle dùng SRI, workflow build chỉ có quyền đọc source và quyền deploy chỉ cấp cho job deploy.
- **Resource Consumption:** quota, timeout và cleanup giảm nguy cơ treo tab; file được chế tạo đặc biệt vẫn có thể làm chậm thiết bị trong giới hạn local nhưng không tạo DoS lên máy chủ AK Scan.

### Kiểm thử bảo mật tự động

`npm test` bao gồm bộ regression bảo mật kiểm tra file giả mạo, header ảnh/PDF không hợp lệ, Unicode Bidi trong filename, text XML không an toàn, giới hạn độ dài và timeout. GitHub Actions chạy dependency audit, lint, typecheck, toàn bộ test và production build trước khi deploy.

```bash
npm run test:security
npm run security:audit
```

Dependabot được cấu hình tại `.github/dependabot.yml`. Tài liệu chi tiết và các rủi ro còn lại nằm trong [06-SECURITY-PRIVACY.md](06-SECURITY-PRIVACY.md).

## Sử dụng

1. Chọn ảnh, PDF hoặc mở camera.
2. Kiểm tra vùng giấy và chỉnh bốn góc nếu cần.
3. Chọn bộ lọc và tinh chỉnh ảnh.
4. Chọn đầu ra PDF, PDF tìm kiếm hoặc Word chỉnh sửa.
5. Kiểm tra kết quả với bản gốc trước khi sử dụng cho tài liệu quan trọng.

Ảnh phẳng, đủ sáng, camera song song mặt giấy và bốn góc được căn chính xác sẽ cho OCR tốt hơn.

## Chạy local

Yêu cầu Node.js 20+ và npm.

```bash
git clone https://github.com/akkhanh05/ak-scan.git
cd ak-scan
npm ci
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000).

## Kiểm tra chất lượng

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

GitHub Actions chạy dependency audit, lint, typecheck, toàn bộ test (bao gồm security regression) và build static site.

## Deploy GitHub Pages

Repository đã có workflow tại `.github/workflows/deploy-pages.yml`.

1. Vào **Settings → Pages** và chọn **GitHub Actions**.
2. Push lên nhánh `main` hoặc chạy workflow thủ công.
3. Với repository này, URL dự kiến là:
   `https://akkhanh05.github.io/ak-scan/`

Nếu dùng tên miền riêng, cấu hình `NEXT_PUBLIC_SITE_URL` và thêm `public/CNAME` chứa tên miền chính thức.

## Giới hạn hiện tại

| Giới hạn | Mức tối đa |
| --- | ---: |
| Số trang mỗi phiên | 20 |
| Dung lượng mỗi ảnh | 15 MB |
| Độ phân giải mỗi ảnh | 24 MP |
| Dung lượng mỗi PDF | 40 MB |
| Tổng pixel mỗi phiên | 160 triệu |

## Công nghệ

- Next.js 16 và React 19
- Canvas API và Offscreen-friendly rendering pipeline
- PDF.js, pdf-lib, jsPDF
- Tesseract.js với dữ liệu `eng` và `vie` nội bộ
- `docx` cho Word chỉnh sửa

## Tài liệu kỹ thuật

- [Kiến trúc hệ thống](02-ARCHITECTURE.md)
- [Pipeline ảnh và OCR](05-IMAGE-OCR-PIPELINE.md)
- [Bảo mật và quyền riêng tư](06-SECURITY-PRIVACY.md)
- [Kế hoạch kiểm thử](08-TEST-PLAN.md)

## Tác giả và bản quyền

Phát triển bởi **akkhanh — THE KODENAK**. Dự án được phát hành miễn phí trên GitHub; vui lòng giữ thông tin tác giả khi sử dụng, chỉnh sửa hoặc chia sẻ lại.

© 2026 akkhanh — THE KODENAK.
