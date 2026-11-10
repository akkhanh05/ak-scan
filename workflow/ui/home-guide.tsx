import { ArrowRight, Camera, Check, Download, FileImage, FileText, FileType2, Images, ScanSearch, SlidersHorizontal } from "lucide-react";

const steps = [
  [FileImage, "01", "Chọn tài liệu", "Chọn JPG, PNG, WebP, PDF hoặc mở camera. PDF nhiều trang sẽ được tách thành từng trang."],
  [ScanSearch, "02", "Căn lại trang", "Dùng Tự dò mép, kiểm tra bốn góc, cân thẳng và làm phẳng giấy cong khi cần."],
  [SlidersHorizontal, "03", "Làm sạch", "Chọn Tăng cường, Xám hoặc Trắng đen rồi chỉnh nền, bóng và độ nét."],
  [Download, "04", "Xuất kết quả", "Chọn khổ giấy, chất lượng và tải PDF; có thể bật nhận diện văn bản hoặc xuất Word."],
] as const;

export function HomeGuide() {
  return (
    <section className="home-guide" id="huong-dan">
      {/* Top Banner Card */}
      <header className="guide-hero">
        <div>
          <p className="overline">Hướng dẫn &amp; thông tin sử dụng</p>
          <h2>Mọi điều cần biết trước khi bắt đầu</h2>
          <p>Một quy trình duy nhất để scan sạch, kiểm tra kết quả và sử dụng tài liệu an toàn.</p>
        </div>
        <div className="guide-free">
          <span>MIỄN PHÍ</span>
          <strong>Phát hành trên GitHub</strong>
          <small>Bản quyền akkhanh — THE KODENAK</small>
        </div>
      </header>

      {/* Nội dung hướng dẫn; mục lục nằm trên thanh điều hướng cố định. */}
      <div className="guide-layout">
        <div className="guide-content">
          {/* Section 1: Bắt đầu */}
          <article className="guide-card" id="bat-dau">
            <p className="overline">Quy trình 4 bước</p>
            <h3>Làm đúng ngay từ lần đầu</h3>
            <div className="guide-steps">
              {steps.map(([Icon, number, title, text]) => (
                <section key={number}>
                  <span>{number}</span>
                  <Icon size={21} />
                  <h4>{title}</h4>
                  <p>{text}</p>
                </section>
              ))}
            </div>
          </article>

          <article className="guide-card workflow-guide-card" id="workflow">
            <p className="overline">Workflow tự động</p>
            <h3>Chọn file, AK Scan tự xác định cách xử lý</h3>
            <p>Hệ thống phân biệt ảnh chụp, PDF chứa ảnh scan và PDF tài liệu có lớp chữ. Mỗi loại đầu vào sẽ đi theo luồng phù hợp để tránh nhận diện lại không cần thiết.</p>
            <div className="workflow-guide-grid">
              <section>
                <div className="workflow-guide-icon"><Camera size={22} /></div>
                <span className="workflow-badge">Luồng 01</span>
                <h4>Ảnh chụp tài liệu</h4>
                <p>JPG, PNG, WebP hoặc ảnh từ camera.</p>
                <div className="workflow-route"><span>Căn 4 góc</span><ArrowRight /><span>Làm sạch</span><ArrowRight /><strong>PDF scan</strong></div>
                <small>Bật “PDF có thể tìm kiếm” khi cần bôi đen, tìm kiếm hoặc sao chép chữ.</small>
              </section>
              <section>
                <div className="workflow-guide-icon"><Images size={22} /></div>
                <span className="workflow-badge">Luồng 02</span>
                <h4>PDF chứa ảnh chụp</h4>
                <p>PDF scan không có lớp chữ đáng tin cậy.</p>
                <div className="workflow-route"><span>Tách từng trang</span><ArrowRight /><span>Scan lại</span><ArrowRight /><strong>PDF scan</strong></div>
                <small>Mỗi trang dùng chung công cụ căn mép, nắn cong, khử bóng và tăng nét như ảnh chụp.</small>
              </section>
              <section>
                <div className="workflow-guide-icon"><FileType2 size={22} /></div>
                <span className="workflow-badge">Luồng 03</span>
                <h4>PDF tài liệu hoàn chỉnh</h4>
                <p>PDF được xuất từ Word hoặc có lớp chữ rõ.</p>
                <div className="workflow-route"><span>Đọc lớp chữ</span><ArrowRight /><span>Khôi phục đoạn</span><ArrowRight /><strong>Word chỉnh sửa</strong></div>
                <small>Không OCR lại nếu lớp chữ dùng được, giúp giữ nội dung chính xác và dễ căn chỉnh trong Word.</small>
              </section>
            </div>
            <div className="workflow-decision-note">
              <FileText size={20} />
              <div><strong>PDF có thể tìm kiếm và Word chỉnh sửa phục vụ hai mục đích khác nhau</strong><p>PDF có thể tìm kiếm ưu tiên giữ nguyên hình ảnh trang để tra cứu và sao chép. Nếu cần chỉnh font, căn đều hai lề hoặc dàn lại nội dung, hãy chọn <b>Word chỉnh sửa</b>.</p></div>
            </div>
          </article>

          {/* Section 2: Ảnh & PDF */}
          <article className="guide-card" id="anh-pdf">
            <p className="overline">Chuẩn bị đầu vào</p>
            <h3>Ảnh rõ sẽ cho bản scan tốt hơn</h3>
            <ul className="check-list">
              <li>
                <Check />
                Đặt giấy trên nền tương phản và đủ sáng.
              </li>
              <li>
                <Check />
                Giữ camera song song, chụp đủ bốn góc và tránh rung.
              </li>
              <li>
                <Check />
                Không che nội dung bằng tay hoặc bóng điện thoại.
              </li>
              <li>
                <Check />
                Ưu tiên ảnh gốc chưa gửi qua ứng dụng chat.
              </li>
            </ul>
            <div className="format-grid">
              <div>
                <FileImage />
                <strong>Ảnh</strong>
                <p>Phù hợp nhất với tài liệu vừa chụp bằng điện thoại.</p>
              </div>
              <div>
                <FileText />
                <strong>PDF</strong>
                <p>Mỗi trang được dựng lossless rồi dùng chung pipeline tăng cường.</p>
              </div>
            </div>
            <div className="tip-box">
              <strong>Giấy hoặc trang sách bị cong?</strong>
              <p>
                Căn đúng bốn góc trước, sau đó bật <b>Làm phẳng giấy cong</b>.
              </p>
            </div>
          </article>

          {/* Section 3: Quyền riêng tư */}
          <article className="guide-card" id="quyen-rieng-tu">
            <p className="overline">Riêng tư theo thiết kế</p>
            <h3>Tài liệu không được tải lên máy chủ</h3>
            <p>
              Ảnh, PDF và nội dung nhận diện văn bản được xử lý trong bộ nhớ trình duyệt. AK Scan không có API upload hay kho lưu tài liệu.
            </p>
            <div className="privacy-flow">
              <span>File trên máy</span>
              <b>→</b>
              <span>Trình duyệt xử lý</span>
              <b>→</b>
              <span>Tải kết quả xuống</span>
            </div>
            <div className="notice-box">
              <strong>Khi dùng máy tính chung</strong>
              <p>Hãy xóa phiên, đóng tab và bảo vệ file trong thư mục tải xuống sau khi hoàn tất.</p>
            </div>
          </article>

          {/* Section 4: Giới hạn */}
          <article className="guide-card" id="gioi-han">
            <p className="overline">Giới hạn xử lý</p>
            <h3>Hiệu năng phụ thuộc thiết bị</h3>
            <div className="limit-grid">
              <div>
                <strong>20</strong>
                <span>trang tối đa</span>
              </div>
              <div>
                <strong>15 MB</strong>
                <span>mỗi ảnh</span>
              </div>
              <div>
                <strong>40 MB</strong>
                <span>mỗi PDF</span>
              </div>
              <div>
                <strong>24 MP</strong>
                <span>mỗi ảnh</span>
              </div>
            </div>
            <p>
              Ảnh rung, chữ quá nhỏ, giấy nhàu mạnh, PDF đã nén nhiều lần và trang sách cong sát gáy có thể không phục hồi hoàn toàn. Ảnh phẳng và bốn góc được căn chính xác sẽ cho kết quả nhận diện tốt hơn; luôn đối chiếu Word với bản gốc.
            </p>
          </article>

          {/* Section 5: Điều khoản */}
          <article className="guide-card" id="dieu-khoan">
            <p className="overline">Bản quyền &amp; điều khoản</p>
            <h3>Miễn phí để sử dụng, có trách nhiệm khi dùng</h3>
            <p>
              AK Scan thuộc quyền tác giả của <strong>akkhanh — THE KODENAK</strong> và được phát hành miễn phí trên GitHub. Quyền sửa đổi, phân phối mã nguồn tuân theo giấy phép đi kèm repository.
            </p>
            <div className="terms-grid">
              <div>
                <strong>Được sử dụng miễn phí</strong>
                <p>Cho công việc cá nhân, học tập và văn phòng.</p>
              </div>
              <div>
                <strong>Phải kiểm tra kết quả</strong>
                <p>AK Scan là công cụ hỗ trợ, không xác nhận tính pháp lý của tài liệu.</p>
              </div>
              <div>
                <strong>Không sử dụng sai mục đích</strong>
                <p>Không giả mạo giấy tờ, làm sai lệch nội dung hoặc xâm phạm quyền của người khác.</p>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

