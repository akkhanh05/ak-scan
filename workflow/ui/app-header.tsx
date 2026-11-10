import { HardDriveDownload, LockKeyhole, Trash2 } from "lucide-react";
import { AkLogo } from "./ak-logo";

type AppHeaderProps = {
  hasPages: boolean;
  exporting: boolean;
  onClearSession: () => void;
  draftEnabled: boolean;
  onToggleDraft: (enabled: boolean) => void;
};

export function AppHeader({ hasPages, exporting, onClearSession, draftEnabled, onToggleDraft }: AppHeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#top" aria-label="AK Scan, về đầu trang">
          <span className="brand-logo-box"><AkLogo size={36} /></span>
          <span className="brand-title">AK Scan</span>
        </a>

        <div className="topbar-capabilities" aria-label="Các chức năng chính">
          <span>Quét tài liệu</span>
          <i aria-hidden="true" />
          <span>PDF sang Word</span>
          <i aria-hidden="true" />
          <span>Xử lý cục bộ</span>
        </div>

        <div className="header-right-actions">
          <label className="draft-toggle" title="Lưu phiên đang làm trong trình duyệt của máy này để mở lại sau. Không gửi đi đâu.">
            <input type="checkbox" checked={draftEnabled} onChange={(event) => onToggleDraft(event.target.checked)} aria-label="Lưu nháp trên máy này" />
            <HardDriveDownload size={14} aria-hidden="true" />
            <span>Lưu nháp trên máy</span>
          </label>
          {hasPages && (
            <button className="clear-session-btn" onClick={onClearSession} disabled={exporting} aria-label="Xóa phiên hiện tại" title="Xóa phiên hiện tại">
              <Trash2 size={15} />
              <span>Xóa phiên hiện tại</span>
            </button>
          )}
          <div className="privacy-pill" title="Xử lý 100% trên thiết bị người dùng" role="note" aria-label="Cục bộ và bảo mật: xử lý 100% trên thiết bị">
            <LockKeyhole size={14} />
            <span>Cục bộ &amp; Bảo mật</span>
          </div>
        </div>
      </div>
    </header>
  );
}
