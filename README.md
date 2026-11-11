# AK Scan

**Quét tài liệu, tạo PDF và chuyển PDF sang Word ngay trên trình duyệt.** Mở [AK Scan](https://akkhanh05.github.io/ak-scan/) để dùng; không cần cài ứng dụng hay đăng nhập.

## AK Scan làm được gì?

- Nhập ảnh chụp, PDF hoặc chụp bằng camera trên thiết bị tương thích.
- Tự nhận diện mép giấy, chỉnh góc, làm sạch ảnh và ghép nhiều trang thành PDF scan.
- Nhận diện chữ tiếng Việt và tiếng Anh để tạo PDF có thể tìm kiếm hoặc Word có thể chỉnh sửa. Bạn có thể xem và sửa chữ trước khi xuất.
- Chuyển PDF có lớp chữ thành Word, giữ lại bố cục tài liệu ở mức gần đúng.
- Lưu nháp trên thiết bị nếu muốn; có thể cài web như một ứng dụng và dùng offline sau lần mở đầu.

Tài liệu được xử lý ngay trong trình duyệt của bạn, không tải lên máy chủ để xử lý. Lưu nháp là tùy chọn và mặc định tắt.

## Cách dùng

1. Mở website và chọn ảnh, PDF hoặc camera.
2. Xem trước, chỉnh vùng giấy và chọn cách xử lý.
3. Xuất PDF hoặc Word rồi tải về thiết bị.

## Công nghệ

Next.js, React, TypeScript, Canvas API, PDF.js, Tesseract.js và các thư viện tạo PDF/Word.

## Chạy từ mã nguồn

Cần Node.js 20.9+ và npm.

```bash
npm ci
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000).

## Tác giả

Phát triển bởi **akkhanh — THE KODENAK**. Dự án được phát hành miễn phí trên GitHub; vui lòng giữ thông tin tác giả khi sử dụng, chỉnh sửa hoặc chia sẻ lại.

Mô hình OCR trong `public/tessdata` thuộc dự án Tesseract OCR, giấy phép Apache-2.0 (nguồn và checksum trong `workflow/ocr-models.json`).

© 2026 akkhanh — THE KODENAK.
