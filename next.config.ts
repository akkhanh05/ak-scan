import type { NextConfig } from "next";

import { buildSecurityHeaders } from "./workflow/shared/core/security-policy";

const isDevelopment = process.env.NODE_ENV === "development";
const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isUserOrOrganizationSite = repositoryName.toLowerCase().endsWith(".github.io");
const basePath = isGitHubPages && repositoryName && !isUserOrOrganizationSite ? `/${repositoryName}` : "";
const securityHeaders = buildSecurityHeaders(isDevelopment);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isGitHubPages ? { output: "export" as const, trailingSlash: true, basePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  experimental: { sri: { algorithm: "sha384" } },
  ...(isGitHubPages ? {} : { async headers() { return [{ source: "/:path*", headers: securityHeaders }]; } }),
};
export default nextConfig;

