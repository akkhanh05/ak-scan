/**
 * Response headers for static hosts, generated from security-policy.ts (the
 * single source of truth). `npm run headers:sync` rewrites:
 *  - public/_headers  → Cloudflare Pages / Netlify (copied into out/)
 *  - vercel.json      → Vercel (static export or Next.js)
 * test-security.ts fails when these files drift from the policy.
 *
 * The meta-tag CSP inside the HTML additionally pins inline scripts by hash;
 * browsers enforce both policies, so the header may keep 'unsafe-inline'.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSecurityHeaders } from "../shared/core/security-policy";

const root = join(__dirname, "..", "..");

export function cloudflareHeaders() {
  const lines = ["/*", ...buildSecurityHeaders(false).map(({ key, value }) => `  ${key}: ${value}`)];
  lines.push("", "/_next/static/*", "  Cache-Control: public, max-age=31536000, immutable", "", "/sw.js", "  Cache-Control: no-cache", "");
  return lines.join("\n");
}

export function vercelConfig() {
  return `${JSON.stringify({
    headers: [
      { source: "/(.*)", headers: buildSecurityHeaders(false) },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ],
  }, null, 2)}\n`;
}

if (require.main === module) {
  writeFileSync(join(root, "public", "_headers"), cloudflareHeaders());
  writeFileSync(join(root, "vercel.json"), vercelConfig());
  console.log("wrote public/_headers and vercel.json");
}
