/**
 * Copies the OCR/PDF runtime files from the installed packages into public/
 * (run automatically before `dev` and `build`). Generating them from the
 * lockfile guarantees the worker, WASM core and PDF.js API always match —
 * a Dependabot bump can no longer leave a stale copy committed in public/.
 * Only the LSTM cores are copied: the app never uses the legacy engine.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fromModules = (...parts) => join(root, "node_modules", ...parts);
const toPublic = (...parts) => join(root, "public", ...parts);

const cores = ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"];
const copies = [
  [fromModules("tesseract.js", "dist", "worker.min.js"), toPublic("tesseract-worker.min.js")],
  [fromModules("pdfjs-dist", "build", "pdf.worker.min.mjs"), toPublic("pdf.worker.min.mjs")],
  ...cores.map((file) => [fromModules("tesseract.js-core", file), toPublic("tesseract-core", file)]),
];

mkdirSync(toPublic("tesseract-core"), { recursive: true });
for (const file of readdirSync(toPublic("tesseract-core"))) if (!cores.includes(file)) rmSync(toPublic("tesseract-core", file));
for (const [source, target] of copies) {
  if (!existsSync(source)) throw new Error(`Missing runtime asset ${source}. Run npm ci first.`);
  copyFileSync(source, target);
}

// The render worker is bundled here (not by Next.js/Turbopack, which copies a
// `new URL("./x.ts", import.meta.url)` worker as a raw .ts asset). A classic
// script worker also runs in browsers without module-worker support.
await build({
  entryPoints: [join(root, "workflow", "shared", "core", "render.worker.ts")],
  outfile: toPublic("render-worker.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020", "safari15"],
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": "\"production\"" },
  logLevel: "warning",
});

const manifest = JSON.parse(readFileSync(join(root, "workflow", "ocr-models.json"), "utf8"));
for (const model of manifest.models) {
  const path = join(root, model.file);
  if (!existsSync(path)) throw new Error(`Missing OCR model ${model.file}.`);
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest !== model.sha256) throw new Error(`OCR model ${model.file} does not match its pinned checksum.`);
}
console.log(`runtime assets synced (${copies.length} files + render worker) · OCR models verified (${manifest.models.length})`);
