/* eslint-disable @typescript-eslint/no-explicit-any -- Test-only cross-runtime error and global mocks. */
import {
  detectUploadKind,
  safeDisplayName,
  sanitizeDocumentText,
  withOcrTimeout,
  withTimeout,
} from "../shared/core/upload-security";
import { buildContentSecurityPolicy, buildSecurityHeaders } from "../shared/core/security-policy";
import { imageDimensionsFromHeader } from "../shared/core/upload-security";
import { OCR_ASSET_VERSION } from "../shared/core/ocr-config";
import { cloudflareHeaders, vercelConfig } from "./host-headers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// Polyfill window for Node.js environment if needed
if (typeof window === "undefined") {
  (globalThis as any).window = globalThis;
}

// Test runner state
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
    failedTests++;
  }
}

async function runTests() {
  console.log("=========================================");
  console.log("   SECURITY & INPUT VALIDATION TESTS     ");
  console.log("=========================================\n");

  const staticPolicy = buildContentSecurityPolicy({ isDevelopment: false });
  const responsePolicy = buildContentSecurityPolicy({ isDevelopment: false, includeFrameAncestors: true });
  const responseHeaders = buildSecurityHeaders(false);
  assert(!staticPolicy.includes("frame-ancestors"), "Static CSP omits header-only frame-ancestors directive");
  assert(responsePolicy.includes("frame-ancestors 'none'"), "Response CSP blocks framing");
  assert(responseHeaders.some((header) => header.key === "X-Frame-Options" && header.value === "DENY"), "Response headers deny framing");
  assert(responsePolicy.includes("wasm-unsafe-eval") && responsePolicy.includes("worker-src 'self' blob:"), "CSP retains WASM and worker support");

  // ---------------------------------------------------------
  // 1. detectUploadKind
  // ---------------------------------------------------------
  console.log("--- 1. Testing detectUploadKind ---");

  // JPG magic bytes (FF D8 FF E0 ...)
  const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const jpgFile = new File([jpgBytes], "photo.jpg", { type: "image/jpeg" });
  const jpgResult = await detectUploadKind(jpgFile);
  assert(jpgResult === "jpeg", "JPG magic bytes (FF D8 FF)", `Got ${jpgResult}`);

  // PNG magic bytes (89 50 4E 47 0D 0A 1A 0A)
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01]);
  const pngFile = new File([pngBytes], "graphic.png", { type: "image/png" });
  const pngResult = await detectUploadKind(pngFile);
  assert(pngResult === "png", "PNG magic bytes (89 50 4E 47 0D 0A 1A 0A)", `Got ${pngResult}`);

  // WebP magic bytes (RIFF...WEBP)
  const webpBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00, // file size dummy
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20, // VP8
  ]);
  const webpFile = new File([webpBytes], "image.webp", { type: "image/webp" });
  const webpResult = await detectUploadKind(webpFile);
  assert(webpResult === "webp", "WebP magic bytes (RIFF....WEBP)", `Got ${webpResult}`);

  // PDF magic bytes (%PDF- at start)
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xd0, 0xd4]);
  const pdfFile = new File([pdfBytes], "doc.pdf", { type: "application/pdf" });
  const pdfResult = await detectUploadKind(pdfFile);
  assert(pdfResult === "pdf", "PDF magic bytes (%PDF- at offset 0)", `Got ${pdfResult}`);

  // PDF magic bytes (%PDF- with header offset within 1024 bytes)
  const pdfOffsetBytes = new Uint8Array([0x00, 0x00, 0x00, 0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);
  const pdfOffsetFile = new File([pdfOffsetBytes], "doc_offset.pdf", { type: "application/pdf" });
  const pdfOffsetResult = await detectUploadKind(pdfOffsetFile);
  assert(pdfOffsetResult === "pdf", "PDF magic bytes (%PDF- with header offset)", `Got ${pdfOffsetResult}`);

  const fakePng = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x48, 0x54, 0x4d, 0x4c])], "fake.png", { type: "image/png" });
  assert(await detectUploadKind(fakePng) === null, "Bare PNG signature without IHDR is rejected");

  const fakePdf = new File([new TextEncoder().encode("notes %PDF-not-a-version")], "fake.pdf", { type: "application/pdf" });
  assert(await detectUploadKind(fakePdf) === null, "Embedded PDF marker without a version is rejected");

  // File extension spoofing 1: HTML file disguised as .jpg
  const htmlContent = new TextEncoder().encode("<!DOCTYPE html><html><body><script>alert('XSS')</script></body></html>");
  const htmlSpoofedFile = new File([htmlContent], "malicious_photo.jpg", { type: "image/jpeg" });
  const htmlSpoofedResult = await detectUploadKind(htmlSpoofedFile);
  assert(htmlSpoofedResult === null, "Spoofed HTML disguised as .jpg (should return null)", `Got ${htmlSpoofedResult}`);

  // File extension spoofing 2: Plain junk text file disguised as .pdf
  const textContent = new TextEncoder().encode("This is just plain text content without any PDF magic headers.");
  const textSpoofedFile = new File([textContent], "fake_doc.pdf", { type: "application/pdf" });
  const textSpoofedResult = await detectUploadKind(textSpoofedFile);
  assert(textSpoofedResult === null, "Junk text file disguised as .pdf (should return null)", `Got ${textSpoofedResult}`);

  // Empty file (0 bytes)
  const emptyFile = new File([new Uint8Array(0)], "empty.jpg", { type: "image/jpeg" });
  const emptyResult = await detectUploadKind(emptyFile);
  assert(emptyResult === null, "Empty 0-byte file (should return null)", `Got ${emptyResult}`);

  console.log();

  // ---------------------------------------------------------
  // 2. safeDisplayName
  // ---------------------------------------------------------
  console.log("--- 2. Testing safeDisplayName ---");

  // Normal filename
  const normalName = "Bao-cao-tai-chinh-2026.pdf";
  const normalNameResult = safeDisplayName(normalName);
  assert(normalNameResult === "Bao-cao-tai-chinh-2026.pdf", "Normal filename preserved", `Got "${normalNameResult}"`);

  // Filename with control characters (\u0000, \u0007, \u001F, \u007F)
  const ctrlName = "Báo\u0000 Cáo\u0007_\u001F2026\u007F.pdf";
  const ctrlNameResult = safeDisplayName(ctrlName);
  assert(ctrlNameResult === "Báo Cáo_2026.pdf", "Control characters stripped (\\u0000, \\u0007, etc.)", `Got "${ctrlNameResult}"`);

  // Empty string
  const emptyNameResult = safeDisplayName("");
  assert(emptyNameResult === "Tài liệu không tên", "Empty filename returns fallback", `Got "${emptyNameResult}"`);

  // Whitespace and control chars only
  const blankNameResult = safeDisplayName("  \u0000\u0007\u001F  ");
  assert(blankNameResult === "Tài liệu không tên", "Whitespace/control-only filename returns fallback", `Got "${blankNameResult}"`);

  const spoofedDirectionName = safeDisplayName("invoice\u202Egpj.exe");
  assert(spoofedDirectionName === "invoicegpj.exe", "Bidirectional filename controls are stripped", `Got "${spoofedDirectionName}"`);

  // Long filename (> 200 characters)
  const longNameInput = "A".repeat(250) + ".pdf";
  const longNameResult = safeDisplayName(longNameInput);
  assert(
    longNameResult.length === 160 && longNameResult === "A".repeat(160),
    "Long filename (>200 chars) truncated to 160 chars max",
    `Got length ${longNameResult.length}`
  );

  console.log();

  // ---------------------------------------------------------
  // 3. sanitizeDocumentText
  // ---------------------------------------------------------
  console.log("--- 3. Testing sanitizeDocumentText ---");

  // Control characters & null bytes removal
  const ctrlText = "Hello\u0000 World\u0007!\u000B Test\u001F Text\u007F.";
  const ctrlTextResult = sanitizeDocumentText(ctrlText);
  assert(ctrlTextResult === "Hello World! Test Text.", "Null bytes and control characters removed", `Got "${ctrlTextResult}"`);

  // Lone surrogates filtering (\uD800 - \uDFFF)
  const surrogateText = "High\uD800Surrogate Low\uDFFFSurrogate Clean";
  const surrogateTextResult = sanitizeDocumentText(surrogateText);
  assert(
    surrogateTextResult === "HighSurrogate LowSurrogate Clean",
    "Lone surrogates (\\uD800, \\uDFFF) removed",
    `Got "${surrogateTextResult}"`
  );

  // Normal text
  const cleanText = "Standard document text with numbers 12345 and punctuation !@#$.";
  const cleanTextResult = sanitizeDocumentText(cleanText);
  assert(cleanTextResult === cleanText, "Normal English text unchanged", `Got "${cleanTextResult}"`);

  // Vietnamese text with diacritics
  const vnText = "Cộng hòa Xã hội Chủ nghĩa Việt Nam - Độc lập - Tự do - Hạnh phúc";
  const vnTextResult = sanitizeDocumentText(vnText);
  assert(vnTextResult === vnText, "Vietnamese text preserved intact", `Got "${vnTextResult}"`);

  // Truncation at 2,000,000 characters
  const oversizeInput = "X".repeat(2_000_100);
  const oversizeResult = sanitizeDocumentText(oversizeInput);
  assert(
    oversizeResult.length === 2_000_000,
    "Text truncated at exactly 2,000,000 characters limit",
    `Got length ${oversizeResult.length}`
  );

  console.log();

  // ---------------------------------------------------------
  // 4. withTimeout
  // ---------------------------------------------------------
  console.log("--- 4. Testing withTimeout ---");

  // Fast resolving promise (completes before timeout)
  try {
    const fastPromise = new Promise<string>((resolve) => setTimeout(() => resolve("success"), 10));
    const fastResult = await withTimeout(fastPromise, 100, "Timed out");
    assert(fastResult === "success", "Promise completes before timeout", `Got ${fastResult}`);
  } catch (err: any) {
    assert(false, "Promise completes before timeout", `Unexpected error: ${err?.message}`);
  }

  let terminatedWorkerCount = 0;
  try {
    await withOcrTimeout({ terminate: async () => { terminatedWorkerCount++; } }, new Promise<string>(() => undefined), 20, "OCR timed out");
    assert(false, "Hanging OCR should trigger timeout");
  } catch (err: any) {
    assert(err?.message === "OCR timed out", "OCR timeout keeps its readable message", `Got error: "${err?.message}"`);
    assert(terminatedWorkerCount === 1, "OCR timeout terminates the worker", `Terminate calls: ${terminatedWorkerCount}`);
  }

  // Hanging promise (exceeds timeout)
  try {
    const slowPromise = new Promise<string>((resolve) => setTimeout(() => resolve("slow"), 200));
    await withTimeout(slowPromise, 50, "Operation timed out after 50ms");
    assert(false, "Hanging promise should trigger timeout error");
  } catch (err: any) {
    assert(
      err?.message === "Operation timed out after 50ms",
      "Hanging promise rejected with specified timeout error message",
      `Got error: "${err?.message}"`
    );
  }

  // Fast rejecting promise
  try {
    const rejectPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("original error")), 10));
    await withTimeout(rejectPromise, 100, "Timed out");
    assert(false, "Rejecting promise should propagate original error");
  } catch (err: any) {
    assert(
      err?.message === "original error",
      "Fast rejecting promise propagates original error correctly",
      `Got error: "${err?.message}"`
    );
  }

  // ----- Image header dimensions (checked before decoding) -----
  console.log("\n[Image header size limits]");
  const png = new Uint8Array(32);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  png.set([0, 0, 0x1f, 0x40, 0, 0, 0x17, 0x70], 16); // 8000 × 6000
  const pngSize = imageDimensionsFromHeader(png, "png");
  assert(pngSize?.width === 8000 && pngSize?.height === 6000, "PNG IHDR size is read without decoding");
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0f, 0xa0, 0x17, 0x70, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const jpegSize = imageDimensionsFromHeader(jpeg, "jpeg");
  assert(jpegSize?.width === 6000 && jpegSize?.height === 4000, "JPEG SOF size is found after an APP1 segment", JSON.stringify(jpegSize));
  const webp = new Uint8Array(30);
  webp.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  webp.set([0x3f, 0x1f, 0x00, 0x6f, 0x17, 0x00], 24); // 8000 × 6000 (minus one, 24-bit LE)
  const webpSize = imageDimensionsFromHeader(webp, "webp");
  assert(webpSize?.width === 8000 && webpSize?.height === 6000, "WebP VP8X canvas size is read", JSON.stringify(webpSize));
  assert(imageDimensionsFromHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xda]), "jpeg") === null, "JPEG without a frame header is rejected");

  // ----- Host header files must match security-policy.ts -----
  console.log("\n[Static host headers]");
  const root = join(__dirname, "..", "..");
  assert(readFileSync(join(root, "public", "_headers"), "utf8") === cloudflareHeaders(), "public/_headers matches security-policy.ts (run npm run headers:sync)");
  assert(readFileSync(join(root, "vercel.json"), "utf8") === vercelConfig(), "vercel.json matches security-policy.ts (run npm run headers:sync)");
  assert(cloudflareHeaders().includes("frame-ancestors 'none'") && cloudflareHeaders().includes("X-Frame-Options: DENY"), "static hosts get anti-framing headers");

  // ----- OCR asset version consistency -----
  console.log("\n[OCR asset versioning]");
  const sw = readFileSync(join(root, "public", "sw.js"), "utf8");
  const models = JSON.parse(readFileSync(join(root, "workflow", "ocr-models.json"), "utf8"));
  assert(sw.includes(`const OCR_ASSET_VERSION = "${OCR_ASSET_VERSION}"`), "service worker cache key matches the OCR model version");
  assert(models.version === OCR_ASSET_VERSION, "model manifest version matches ocr-config.ts");
  for (const model of models.models) {
    const digest = createHash("sha256").update(readFileSync(join(root, model.file))).digest("hex");
    assert(digest === model.sha256, `bundled model ${model.file} matches its pinned checksum`);
  }

  console.log("\n=========================================");
  console.log(` SUMMARY: ${passedTests} Passed, ${failedTests} Failed `);
  console.log("=========================================\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});


