# Kế hoạch kiểm thử AK Scan

## 1. Mục tiêu

Xác nhận ứng dụng client-only nhập file an toàn, xử lý ảnh đúng, **không làm mất hoặc tự sửa nội dung**, xuất file mở được với nội dung đúng, và hoạt động trên bản build tĩnh thật với base path và header production.

## 2. Kiểm tra tự động

| Lệnh | Nội dung |
|---|---|
| `npm run lint`, `npm run typecheck` | ESLint, TypeScript |
| `npm run test:scan` | Hàm pixel thuần, làm mờ thay `ctx.filter`, homography và ánh xạ điểm theo cắt/xoay |
| `npm run test:security` | Magic bytes, kích thước từ header, sanitize, timeout, CSP/header, header cho host không lệch policy, checksum + phiên bản mô hình OCR |
| `npm run test:ocr` | Toàn vẹn OCR: giữ dòng lặp hợp lệ, không sửa chữ, không xóa chữ số, từ một chữ cái tiếng Việt, dòng cao (có dấu) không thay chỗ nhau, thứ tự cột, đoạn/heading/danh sách/bảng |
| `npm run test:pdf-layout` | PDF tổng hợp kiểu Excel: bảng từ đường kẻ, ô gộp dọc/ngang, tách nhãn trong ô gộp, nền màu, form không viền, hàng chữ ký, đoạn, vùng cắt, phân loại document/scan. Tùy chọn: `AK_SCAN_SAMPLE_PDF=<file>` chạy thêm trên PDF thật (không commit) |
| `npm run test:export` | Gọi **chính pipeline và bộ xuất của ứng dụng** (chỉ giả render/Tesseract), mở DOCX/PDF tạo ra để kiểm: bảng, gridSpan/vMerge, màu, `vi-VN`, khổ A4/Letter, lề 8/15 mm, vùng cắt, sửa ở bước duyệt, numbering, lớp chữ PDF đúng vị trí, chế độ chữ vô hình, trang xoay, ảnh 1-bit, tên file |
| `npm run test:ocr-accuracy` | OCR thật bằng mô hình đóng gói, cấu hình production, ảnh tiếng Việt/Anh sạch và “chụp điện thoại”; ngưỡng CER/WER |
| `npm run test:e2e` | Playwright trên bản `out/` với base path `/ak-scan`, header từ `_headers`, cache rỗng: PDF có lớp chữ → Word; ảnh → OCR → duyệt → Word; ảnh → PDF tìm kiếm; PDF 22 trang → chọn khoảng trang; undo/redo + preview trong Worker; hủy OCR. Mọi test thất bại nếu có vi phạm CSP, lỗi JS, HTTP ≥ 400 hoặc request ra ngoài origin |
| `npm run build` (postbuild) | Thiếu/sai checksum mô hình, worker, font, service worker, icon → build thất bại; hash script inline vào CSP |

CI (`.github/workflows/deploy-pages.yml`) chạy audit (moderate), lint, typecheck, toàn bộ test, build, e2e; chỉ deploy khi tất cả đạt.

Chạy e2e cục bộ:

```bash
STATIC_EXPORT=true BASE_PATH=/ak-scan npm run build
npm run test:e2e
```

## 3. Ma trận input và bảo mật

| Ca kiểm thử | Kỳ vọng |
|---|---|
| HTML đổi tên `.jpg` | Bị từ chối bằng magic bytes |
| Ảnh 8000×6000 (48 MP) | Bị từ chối từ header, không giải mã |
| PDF/ảnh rỗng, hỏng, có mật khẩu | Báo lỗi rõ, không tạo trang |
| PDF trên 40 MB | Bị từ chối trước khi parse |
| PDF dài hơn số chỗ còn lại | Hỏi khoảng trang; báo rõ phần không nhập |
| PDF + ảnh cùng lúc vượt 20 trang | Không vượt 20; ảnh thừa được báo bỏ qua |
| Vượt quota pixel | Dừng trước khi render trang vượt, báo rõ |
| Hủy khi đang tải mô hình / đang nhận diện | Dừng ngay, thông báo “Đã hủy”, worker bị terminate |

## 4. Kiểm tra thủ công còn lại

- Safari iOS 16/17 (OffscreenCanvas, chuyển về luồng chính nếu cần), Firefox desktop, Chrome Android RAM thấp.
- Camera trên điện thoại; ảnh EXIF xoay.
- Mở DOCX trong Microsoft Word, LibreOffice và Google Docs; PDF tìm kiếm trong Adobe Reader (bôi chọn, tìm “Tổng cộng”).
- Trang cong sát gáy sách, bóng tay, con dấu đỏ, bảng màu.
- Cài PWA, dùng offline sau lần truy cập đầu.

## 5. Release gate

- Lint, typecheck, toàn bộ test, build và e2e đạt; audit không có lỗ hổng mức moderate trở lên.
- Không có regression mất dòng/số liệu trong test OCR và test xuất.
- README, kiến trúc, pipeline, bảo mật và test plan khớp source.
