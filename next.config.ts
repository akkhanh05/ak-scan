import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

import { buildSecurityHeaders } from "./workflow/shared/core/security-policy";

const isDevelopment = process.env.NODE_ENV === "development";
// GitHub Pages: built in GitHub Actions. Other static hosts (Cloudflare Pages,
// Vercel static) opt in with STATIC_EXPORT=true; BASE_PATH overrides the path.
const isGitHubPages = process.env.GITHUB_ACTIONS === "true" && process.env.STATIC_EXPORT !== "false";
const isStaticExport = process.env.STATIC_EXPORT === "true" || isGitHubPages;
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isUserOrOrganizationSite = repositoryName.toLowerCase().endsWith(".github.io");
const basePath = process.env.BASE_PATH ?? (isGitHubPages && repositoryName && !isUserOrOrganizationSite ? `/${repositoryName}` : "");
const securityHeaders = buildSecurityHeaders(isDevelopment);
// Content hash of the prebuilt render worker (written by the prebuild script).
const workerFile = join(process.cwd(), "public", "render-worker.js");
const renderWorkerVersion = existsSync(workerFile) ? createHash("sha256").update(readFileSync(workerFile)).digest("hex").slice(0, 12) : "dev";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(isStaticExport ? { output: "export" as const, trailingSlash: true, basePath } : { basePath }),
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_RENDER_WORKER_VERSION: renderWorkerVersion },
  experimental: { sri: { algorithm: "sha384" } },
  ...(isStaticExport ? {} : { async headers() { return [{ source: "/:path*", headers: securityHeaders }]; } }),
};
export default nextConfig;
