export type SecurityPolicyOptions = {
  isDevelopment: boolean;
  includeFrameAncestors?: boolean;
};

/**
 * CSP shared by the static HTML fallback and Next.js response headers.
 * `frame-ancestors` is omitted from the meta variant because browsers only
 * enforce that directive when it is delivered as an HTTP response header.
 */
export function buildContentSecurityPolicy({
  isDevelopment,
  includeFrameAncestors = false,
}: SecurityPolicyOptions): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(includeFrameAncestors ? ["frame-ancestors 'none'"] : []),
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function buildSecurityHeaders(isDevelopment: boolean) {
  return [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy({ isDevelopment, includeFrameAncestors: true }) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), browsing-topics=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ...(isDevelopment ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
  ];
}
