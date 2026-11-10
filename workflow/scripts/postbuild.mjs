/**
 * Runs after `next build`.
 *  1. Fails the build when a runtime asset needed for OCR/PDF is missing or
 *     its checksum differs (the reason OCR shipped broken before).
 *  2. For static exports, replaces `'unsafe-inline'` in the script-src of the
 *     CSP meta tag with SHA-256 hashes of the exact inline scripts Next.js
 *     emitted, so injected inline script cannot run.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const isStaticExport = process.env.STATIC_EXPORT === "true" || (process.env.GITHUB_ACTIONS === "true" && process.env.STATIC_EXPORT !== "false");
const outputRoot = isStaticExport ? join(root, "out") : join(root, "public");
const errors = [];
if (isStaticExport && existsSync(join(root, "out", "_next", "static", "media"))) {
  // A worker shipped as raw TypeScript would silently fall back to the main thread.
  const stray = readdirSync(join(root, "out", "_next", "static", "media")).filter((file) => file.endsWith(".ts"));
  if (stray.length) errors.push(`TypeScript shipped as a static asset: ${stray.join(", ")}`);
}

const required = [
  "tesseract-worker.min.js",
  "tesseract-core/tesseract-core-lstm.wasm.js",
  "tesseract-core/tesseract-core-simd-lstm.wasm.js",
  "tesseract-core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "pdf.worker.min.mjs",
  "render-worker.js",
  "NotoSans-Regular.ttf",
  "sw.js",
  "site.webmanifest",
  "icon-192.png",
  "icon-512.png",
];
for (const file of required) {
  const path = join(outputRoot, file);
  if (!existsSync(path) || statSync(path).size === 0) errors.push(`missing or empty: ${file}`);
}
const manifest = JSON.parse(readFileSync(join(root, "workflow", "ocr-models.json"), "utf8"));
for (const model of manifest.models) {
  const path = join(outputRoot, model.file.replace(/^public\//, ""));
  if (!existsSync(path)) { errors.push(`missing OCR model: ${model.file}`); continue; }
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest !== model.sha256) errors.push(`OCR model checksum mismatch: ${model.file}`);
}
const sw = readFileSync(join(root, "public", "sw.js"), "utf8");
const config = readFileSync(join(root, "workflow", "shared", "core", "ocr-config.ts"), "utf8");
const version = config.match(/OCR_ASSET_VERSION = "([^"]+)"/)?.[1];
if (!version || !sw.includes(`const OCR_ASSET_VERSION = "${version}"`) || manifest.version !== version) errors.push("OCR_ASSET_VERSION differs between ocr-config.ts, sw.js and ocr-models.json");

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith(".html") ? [path] : [];
  });
}

if (isStaticExport && existsSync(join(root, "out"))) {
  let hashed = 0;
  for (const file of htmlFiles(join(root, "out"))) {
    let html = readFileSync(file, "utf8");
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter(([, attributes]) => !/type="application\/(ld\+)?json"/.test(attributes))
      .map(([, , body]) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
    const metaPattern = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/;
    const meta = html.match(metaPattern);
    if (!meta) { errors.push(`no CSP meta tag in ${file}`); continue; }
    // React escapes quotes inside attributes (&#x27;): decode, edit, re-encode.
    const decoded = meta[2].replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
    if (!/script-src [^;]*'unsafe-inline'/.test(decoded)) { errors.push(`CSP meta in ${file} has no script-src 'unsafe-inline' to replace`); continue; }
    const policy = decoded.replace(/script-src ([^;]*)/, (_, sources) => `script-src ${sources.replace("'unsafe-inline'", [...new Set(scripts)].join(" ") || "'none'")}`);
    html = html.replace(metaPattern, (_, open, __, close) => `${open}${policy.replace(/&/g, "&amp;").replace(/'/g, "&#x27;")}${close}`);
    writeFileSync(file, html);
    hashed += scripts.length;
  }
  console.log(`CSP: hashed ${hashed} inline scripts`);
}

if (errors.length) {
  console.error(`postbuild checks failed:\n - ${errors.join("\n - ")}`);
  process.exit(1);
}
console.log(`postbuild checks passed (${isStaticExport ? "static export" : "server build"})`);
