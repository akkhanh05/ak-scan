# Pipeline ảnh, OCR và dựng lại tài liệu

## 1. Nguyên tắc

1. **Không làm mất hoặc tự sửa nội dung.** Không có luật sửa chữ theo từ điển/mẫu; chữ số không bao giờ bị xóa; dòng lặp chỉ bị gộp khi trùng cả nội dung lẫn vị trí. Chỗ chưa chắc chắn được đánh dấu để người dùng kiểm tra.
2. **Dùng nguồn chính xác nhất có sẵn:** PDF có lớp chữ dùng chính lớp chữ đó (Word và PDF tìm kiếm), chỉ trang ảnh mới OCR.
3. **Một ý nghĩa cho mỗi tùy chọn** (khổ giấy, lề, chất lượng) ở mọi định dạng xuất — xem `export-options.ts`.

## 2. Render trang (`renderPage`, chạy trong Worker)

1. Giải mã ảnh (EXIF orientation) bằng `createImageBitmap`.
2. Tỷ lệ nguồn tính theo **kích thước vùng được cắt**, không theo cả ảnh, nên tài liệu nhỏ trong ảnh lớn không mất chi tiết; có trần pixel theo RAM thiết bị.
3. Nắn phối cảnh bằng lưới tam giác (homography của bốn góc).
4. Chỉ với ảnh chụp: làm phẳng giấy cong (khi đường chữ cong đủ tin cậy) và tự cân thẳng. Trang PDF có lớp chữ bỏ qua hai bước này để lớp chữ khớp pixel.
5. `fineRotation` (±3°) và xoay 90/180/270.
6. Bộ lọc: `original`, `enhanced`, `grayscale`, `bw`. Bản đồ nền giấy dùng **làm mờ bằng JS** (3 lượt box blur) thay cho `ctx.filter`, vốn không chạy trên Safari < 18 và trong một số OffscreenCanvas.

Preview chỉ render khi thao tác dừng ~140 ms và chỉ bản mới nhất được dựng (các yêu cầu cũ bị bỏ).

`page-geometry.ts` áp đúng chuỗi biến đổi trên cho **điểm** (homography nghịch, xoay quanh tâm có hệ số fit) để đặt lớp chữ PDF lên ảnh đã cắt/xoay.

## 3. Dò mép

`detectDocumentCorners` (Worker) tìm cặp cạnh trái/phải, trên/dưới bằng biến đổi kiểu Hough trên gradient, chấm điểm theo vị trí, độ tương phản giấy/nền; giao điểm tạo bốn góc. Khi nhập ảnh, góc tự áp dụng nếu độ tin cậy ≥ 0,58; nếu không, trang được gắn cảnh báo “Kiểm tra 4 góc”. Khi chỉnh tay có kính lúp phóng 3× tại góc đang kéo; phím mũi tên dịch góc (Shift: nhanh).

## 4. Mô hình OCR

| Cấu hình | VI sạch | VI ảnh chụp | VI ảnh chụp xấu | EN sạch/ảnh chụp | EN ảnh chụp xấu |
|---|---|---|---|---|---|
| `eng+vie` (cũ) | 1,11% | 1,11% | 7,44% | 0,22% | 5,48% |
| `Vietnamese+eng` — **đang dùng** | 0,16% | 0,16% | 3,96% | 0,22% | 6,14% |

(CER — tỷ lệ ký tự sai; ảnh mẫu tổng hợp 300 dpi, “ảnh chụp” = thu 66%, xoay, mờ, nhiễu, JPEG 70; “xấu” = thu 45%, mờ mạnh, JPEG 55. Đánh đổi: tiếng Việt giảm lỗi khoảng một nửa, tiếng Anh trên ảnh rất xấu kém đi ~0,7 điểm.)

- `tessdata_best` dạng float **không chạy** trong tesseract.js 7 (lõi WASM thiếu dot-product float), nên `best_int` là bản chính xác nhất dùng được.
- Mô hình nằm trong `public/tessdata/*.traineddata.gz` (≈4,4 MB), checksum ghim trong `workflow/ocr-models.json`, khóa cache IndexedDB có phiên bản (`OCR_ASSET_VERSION`).
- `npm run test:ocr-accuracy` đo lại CER/WER trên ảnh mẫu tổng hợp mỗi lần chạy test.

## 5. OCR một trang (`recognizePage`)

1. Render bản xám (removeShadow ≥ 42, whiten ≥ 24) ở cạnh dài 3.200 px, đồng thời dò lưới bảng.
2. Nhận diện với chế độ bố cục đã chọn: Tự động (PSM 3, nhận nhiều cột), Một cột (PSM 4), Rải rác (PSM 11).
3. Nếu độ tin cậy < 96: thêm bản `enhanced` (và `bw` nếu < 91), và một lượt PSM 6.
4. `selectBestOcrLines` chọn kết quả tốt nhất **theo từng dòng**, giữ thứ tự đọc của lượt đầu (không xen cột). Ghép dòng chỉ khi hai khung chồng nhau ≥ 60% chiều cao — tránh lỗi cũ làm dòng kế tiếp thay chỗ và mất một dòng ở mỗi đoạn tiếng Việt.
5. Tối đa 10 dòng đáng ngờ được đọc lại riêng (PSM 7); kết quả chỉ được nhận khi độ dài tương đương dòng gốc.
6. `cleanPositionedLine`: nối mảnh chữ (“s”+“ocial”), loại vệt nhỏ một chữ cái không phải từ thật; giữ từ một chữ cái tiếng Việt (à, á, ở, ý…), đơn vị sau số, và mọi chữ số.

## 6. Dựng lại tài liệu

**Trang PDF có lớp chữ (`pdf-document.ts`):**
- Bảng có viền dựng từ đường kẻ (hình chữ nhật mảnh hoặc nét vẽ) và cạnh ô tô màu; phát hiện ô gộp ngang/dọc; ô gộp chứa nhiều nhãn (“Lot 1 / Lot 2”) được tách tại ranh giới cột phù hợp; giữ màu nền ô, chữ trắng trên nền tối, căn giữa/phải.
- Dòng thẳng hàng nhiều cột không viền (form “Nhãn: giá trị”, hàng chữ ký) thành bảng không viền.
- Đoạn văn: nối dòng xuống dòng tự nhiên, tách khi dòng ngắn hoặc dòng mới bắt đầu bằng “Nhãn:”; heading theo cỡ chữ/đậm; danh sách thành numbering thật; khoảng trống lớn trong dòng thành tab.
- Font gốc (Calibri, Times New Roman…), đậm/nghiêng lấy từ tên font nhúng; ảnh (logo) được cắt từ trang.
- Vùng cắt của người dùng áp dụng cho Word: nội dung ngoài vùng cắt bị bỏ.

**Trang OCR (`ocr-structure.ts`):** đoạn theo phân đoạn của Tesseract + khoảng cách dọc; dòng ngắn kết thúc đoạn; mã có gạch nối giữ nguyên (“SS6960-” + “Phantom”); heading/tiêu đề theo chiều cao dòng; danh sách đánh số; bảng từ lưới đường kẻ dò được trong ảnh.

**Word (`export/word.ts`):** mỗi trang nguồn là một section với khổ giấy/lề đã chọn (Như bản gốc = khổ PDF), ngôn ngữ soát chính tả `vi-VN`, heading dùng style Word thật, bảng có độ rộng cột theo nguồn (thu nhỏ khi vượt trang). “Gần bố cục gốc” thêm thụt lề/khoảng cách theo vị trí nguồn và ảnh nổi theo vị trí.

## 7. Xuất PDF (`export/pdf.ts`)

- pdf-lib cho cả PDF thường và PDF tìm kiếm; cùng quy tắc khổ giấy/lề (A4/Letter tự xoay ngang cho nội dung ngang; Vừa ảnh = cạnh dài A4).
- Trang trắng đen lưu ảnh **1-bit** (DeviceGray, Flate), nhỏ hơn nhiều so với PNG/JPEG 8-bit.
- Lớp chữ dùng chế độ render vô hình (Tr 3) và co giãn ngang (Tz) để vùng chọn khớp đúng chữ in; trang PDF có lớp chữ dùng chữ gốc ánh xạ qua cắt/xoay.
- Metadata: tiêu đề theo tên file nguồn, `vi-VN`, Creator/Producer AK Scan.

## 8. Bước xem và sửa chữ

Khi có trang cần OCR và người dùng bật “Xem và sửa chữ trước khi tạo file”, mỗi dòng hiện cạnh ảnh cắt đúng dòng đó; dòng chưa chắc chắn tô vàng, có nút nhảy tới dòng cần kiểm tra tiếp theo. Bản sửa được dùng cho cả Word và lớp chữ PDF.
