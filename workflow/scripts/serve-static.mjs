/**
 * Minimal static server for end-to-end tests. Serves out/ under an optional
 * base path and applies public/_headers like Cloudflare Pages would, so the
 * tests run against the exact production files and security headers.
 *   node workflow/scripts/serve-static.mjs <port> [basePath]
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "out");
const port = Number(process.argv[2] ?? 4173);
const base = (process.argv[3] ?? "").replace(/\/$/, "");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".ttf": "font/ttf", ".wasm": "application/wasm", ".gz": "application/gzip", ".txt": "text/plain" };
const headerLines = existsSync(join(root, "_headers")) ? readFileSync(join(root, "_headers"), "utf8").split("\n") : [];
const globalHeaders = [];
for (const line of headerLines.slice(1)) { if (!line.startsWith("  ")) break; const [key, ...value] = line.trim().split(": "); globalHeaders.push([key, value.join(": ")]); }

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (base && !url.pathname.startsWith(`${base}/`) && url.pathname !== base) { response.writeHead(404).end(); return; }
  let path = normalize(decodeURIComponent(url.pathname.slice(base.length) || "/"));
  if (path.includes("..")) { response.writeHead(400).end(); return; }
  let file = join(root, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) { response.writeHead(404, { "Content-Type": "text/plain" }).end("not found"); return; }
  // HSTS/upgrade-insecure-requests are meaningless on plain-HTTP localhost.
  for (const [key, value] of globalHeaders) if (key !== "Strict-Transport-Security") response.setHeader(key, value.replace("; upgrade-insecure-requests", ""));
  response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
  response.end(readFileSync(file));
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}${base}/`));
