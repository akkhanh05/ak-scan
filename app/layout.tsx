import type { Metadata, Viewport } from "next";
import "./globals.css";
import { buildContentSecurityPolicy } from "@/workflow/shared/core/security-policy";
import { ServiceWorkerRegistration } from "@/workflow/ui/service-worker";

const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER;
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const siteUrl = configuredSiteUrl ?? (repositoryOwner && repositoryName
  ? `https://${repositoryOwner}.github.io/${repositoryName}/`
  : "http://localhost:3000/");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "AK Scan – Quét tài liệu, tạo PDF và chuyển PDF sang Word",
  description: "Quét ảnh tài liệu, xử lý PDF scan và chuyển PDF có lớp chữ sang Word ngay trên thiết bị. Không tải tài liệu lên máy chủ.",
  authors: [{ name: "akkhanh — THE KODENAK" }],
  creator: "akkhanh — THE KODENAK",
  applicationName: "AK Scan",
  manifest: "site.webmanifest",
  icons: {
    icon: [{ url: "favicon.ico" }, { url: "favicon-32x32.png", type: "image/png", sizes: "32x32" }],
    apple: [{ url: "apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
    other: [{ rel: "icon", url: "icon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    url: siteUrl,
    siteName: "AK Scan",
    title: "AK Scan – Quét tài liệu, tạo PDF và chuyển PDF sang Word",
    description: "Xử lý ảnh và PDF hoàn toàn trên thiết bị, không tải tài liệu lên máy chủ.",
    images: [{ url: "og-image.png", width: 1200, height: 630, alt: "AK Scan – Quét tài liệu và chuyển PDF sang Word" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AK Scan – Quét tài liệu và chuyển PDF sang Word",
    description: "Xử lý cục bộ trên thiết bị, không tải tài liệu lên máy chủ.",
    images: ["og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2563eb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

const staticContentSecurityPolicy = buildContentSecurityPolicy({
  isDevelopment: process.env.NODE_ENV === "development",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><head><meta httpEquiv="Content-Security-Policy" content={staticContentSecurityPolicy} /></head><body>{children}<ServiceWorkerRegistration /></body></html>;
}

