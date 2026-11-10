import { LockKeyhole, ScanLine, Trash2 } from "lucide-react";

type AppHeaderProps = {
  hasPages: boolean;
  exporting: boolean;
  onClearSession: () => void;
};

export function AppHeader({ hasPages, exporting, onClearSession }: AppHeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#top" aria-label="AK Scan, về đầu trang">
          <span className="brand-logo-box"><ScanLine size={18} /></span>
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
          {hasPages && (
            <button className="clear-session-btn" onClick={onClearSession} disabled={exporting}>
              <Trash2 size={15} />
              <span>Xóa phiên hiện tại</span>
            </button>
          )}
          <div className="privacy-pill" title="Xử lý 100% trên thiết bị người dùng">
            <LockKeyhole size={14} />
            <span>Cục bộ &amp; Bảo mật</span>
          </div>
        </div>
      </div>
    </header>
  );
}

