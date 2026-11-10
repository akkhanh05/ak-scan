import { Columns3, FileSearch, FileText, Gauge, Languages, LayoutTemplate, Lightbulb, ScanText } from "lucide-react";

const presets = [
  { title: "PDF để gửi hoặc in", value: "A4 · Lề nhỏ · Cân bằng", note: "Phù hợp tài liệu văn phòng và chia sẻ thông thường." },
  { title: "PDF cần tìm kiếm chữ", value: "Bật PDF có thể tìm kiếm", note: "Hệ thống tự tối ưu ảnh và nhận diện chữ ngay trên thiết bị." },
  { title: "Word để chỉnh sửa", value: "Xuất Word · Xem và sửa chữ", note: "Từng dòng nhận diện được đặt cạnh ảnh gốc để bạn sửa trước khi tạo file." },
] as const;

const options = [
  [LayoutTemplate, "Khổ trang", "A4 dùng phổ biến tại Việt Nam; Letter phù hợp tài liệu Mỹ; Vừa ảnh giữ đúng tỷ lệ ảnh gốc."],
  [Gauge, "Lề và chất lượng", "Lề nhỏ là lựa chọn an toàn. Chọn Cao khi tài liệu có chữ rất nhỏ; chọn Gọn khi cần file nhẹ."],
  [Languages, "Nhận diện văn bản", "PDF có text sẽ được giữ nguyên; PDF scan ảnh mới được nhận diện văn bản tự động."],
  [Columns3, "Bố cục văn bản", "Tự động nhận cả trang nhiều cột; Một cột cho hợp đồng, bài viết; Rải rác cho biểu mẫu, hóa đơn và ghi chú."],
] as const;

export function ExportGuide() {
  return <section className="export-guide" aria-labelledby="export-guide-title">
    <header className="export-guide-head">
      <div className="export-guide-icon"><ScanText size={23} /></div>
      <div><p className="overline">Hướng dẫn xuất file &amp; nhận diện văn bản</p><h2 id="export-guide-title">Chọn đúng để file rõ, nhẹ và dễ chỉnh sửa</h2><p>Nếu chưa chắc, cứ dùng cấu hình được đánh dấu <strong>Khuyên dùng</strong> trong cửa sổ xuất.</p></div>
    </header>
    <div className="export-guide-presets" aria-label="Cấu hình gợi ý">{presets.map((preset, index) => <article key={preset.title}><span>0{index + 1}</span>{index === 0 ? <FileText size={19} /> : index === 1 ? <FileSearch size={19} /> : <ScanText size={19} />}<h3>{preset.title}</h3><strong>{preset.value}</strong><p>{preset.note}</p></article>)}</div>
    <div className="export-guide-options">{options.map(([Icon, title, text]) => <article key={title}><Icon size={19} /><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
    <aside className="export-guide-tip"><Lightbulb size={20} /><div><strong>Mẹo để nhận diện chính xác hơn</strong><p>Chụp tài liệu phẳng, giữ chữ đủ lớn và căn đúng cả bốn góc trang. Với ảnh mờ, dùng Xám hoặc Tăng cường trước khi xuất. Hệ thống nhận diện nguyên nội dung, không tự sửa từ và không dịch; dòng chưa chắc chắn được đánh dấu để bạn kiểm tra.</p></div></aside>
  </section>;
}

