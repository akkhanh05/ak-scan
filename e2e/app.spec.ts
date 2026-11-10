import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { packingSlipPdf } from "../workflow/scripts/pdf-fixtures";

const fixtures = join(__dirname, "..", "workflow", "scripts", "fixtures", "ocr");

/** Fails the test on CSP violations, uncaught errors and any third-party request. */
async function guard(page: Page) {
  const problems: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp: string[] }).__csp = [...((window as unknown as { __csp?: string[] }).__csp ?? []), `${event.violatedDirective} ${event.blockedURI}`];
    });
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" && !/favicon|Download the React DevTools/.test(message.text())) problems.push(`console: ${message.text()}`); });
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://localhost:4173/") && !url.startsWith("blob:") && !url.startsWith("data:")) problems.push(`external request: ${url}`);
  });
  page.on("response", (response) => { if (response.status() >= 400) problems.push(`HTTP ${response.status()} ${response.url()}`); });
  return async () => {
    const csp = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    expect([...problems, ...csp.map((item) => `CSP violation: ${item}`)]).toEqual([]);
  };
}

async function docxXml(path: string) {
  const zip = await JSZip.loadAsync(readFileSync(path));
  return zip.file("word/document.xml")!.async("text");
}
/** Plain text of every paragraph (runs joined), as Word would show it. */
function paragraphsOf(xml: string) {
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((paragraph) => (paragraph.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g) ?? []).map((part) => part === "<w:tab/>" ? "\t" : part.replace(/<[^>]+>/g, "")).join(""));
}

async function pdfText(path: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const content = await (await pdf.getPage(number)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  await task.destroy();
  return pages.join("\n");
}

async function upload(page: Page, accept: string, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.locator(`input[type=file][accept="${accept}"]`).first().setInputFiles(files);
}

test("text-layer PDF becomes an editable Word file with real tables", async ({ page }) => {
  const check = await guard(page);
  await page.goto("./");
  await upload(page, "application/pdf,.pdf", [{ name: "phieu-xuat-kho.pdf", mimeType: "application/pdf", buffer: Buffer.from(await packingSlipPdf()) }]);
  await expect(page.locator(".live-message")).toContainText("trang PDF có lớp chữ");
  await page.getByRole("button", { name: /Tùy chọn & tải Word/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tạo Word" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("phieu-xuat-kho.docx");
  const xml = await docxXml(await file.path());
  expect(xml).toContain("SS6960-Phantom");
  expect(xml).toContain("<w:gridSpan w:val=\"2\"/>");
  expect(xml).toContain("<w:vMerge w:val=\"restart\"/>");
  expect(xml).toContain("w:fill=\"d12b2b\"");
  await check();
});

test("phone photo → OCR (cold cache) → review → Word keeps Vietnamese and repeated totals", async ({ page }) => {
  const check = await guard(page);
  await page.goto("./");
  await upload(page, "image/jpeg,image/png,image/webp", [{ name: "bien-ban.jpg", mimeType: "image/jpeg", buffer: readFileSync(join(fixtures, "vi-photo.jpg")) }]);
  await expect(page.locator(".live-message")).toContainText("Đã thêm 1 trang");
  await page.getByRole("button", { name: /Tùy chọn & tải PDF/ }).click();
  await page.locator("dialog[open]").getByText("Word chỉnh sửa", { exact: true }).click();
  await page.getByRole("button", { name: "Tạo Word" }).click();
  await expect(page.getByRole("heading", { name: "Kiểm tra chữ đã nhận diện" })).toBeVisible({ timeout: 150_000 });
  const firstLine = page.locator(".review-body input").first();
  await expect(firstLine).toHaveValue(/BIÊN BẢN BÀN GIAO TÀI LIỆU/);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Tạo file với nội dung này/ }).click();
  const xml = await docxXml(await (await download).path());
  const text = paragraphsOf(xml).join("\n");
  if (process.env.E2E_DEBUG) console.log(text);
  // Both totals survive (OCR may misread one letter; the review step shows it).
  expect(text.match(/T[ổốồ]ng cộng: 100\.000/g)?.length).toBe(2);
  expect(text).toContain("có đại diện bên giao và bên nhận");
  expect(text).toContain("15/11/2026");
  expect(text).toContain("125.450.000");
  expect(text).toContain("Ở đây, ý chí của các bên");
  expect(xml).toContain("w:val=\"vi-VN\"");
  await check();
});

test("photo → searchable PDF has a selectable Vietnamese text layer", async ({ page }) => {
  const check = await guard(page);
  await page.goto("./");
  await upload(page, "image/jpeg,image/png,image/webp", [{ name: "bien-ban.jpg", mimeType: "image/jpeg", buffer: readFileSync(join(fixtures, "vi-photo.jpg")) }]);
  await expect(page.locator(".live-message")).toContainText("Đã thêm 1 trang");
  await page.getByRole("button", { name: /Tùy chọn & tải PDF/ }).click();
  await page.locator("dialog[open]").getByText("PDF có thể tìm kiếm", { exact: true }).click();
  await page.locator("dialog[open]").getByText("Xem và sửa chữ trước khi tạo file").click();
  const download = page.waitForEvent("download", { timeout: 150_000 });
  await page.getByRole("button", { name: "Tạo PDF" }).click();
  const text = await pdfText(await (await download).path());
  expect(text).toContain("Điều 1.");
  expect(text).toContain("Tổng cộng: 100.000");
  await check();
});

test("a PDF longer than the session asks which pages to import", async ({ page }) => {
  const check = await guard(page);
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= 22; number++) document.addPage([300, 400]).drawText(`Page ${number} of the long test document`, { x: 20, y: 300, size: 12, font });
  await page.goto("./");
  // PDF and photo dropped together: the session must still stop at 20 pages.
  const pdfFile = { name: "dai.pdf", mimeType: "application/pdf", buffer: Buffer.from(await document.save()) };
  const photo = { name: "anh.png", mimeType: "image/png", buffer: readFileSync(join(fixtures, "en-clean.png")) };
  await page.locator(".upload-zone-card").dispatchEvent("drop", { dataTransfer: await page.evaluateHandle(({ pdf, png }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], "dai.pdf", { type: "application/pdf" }));
    transfer.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], "anh.png", { type: "image/png" }));
    return transfer;
  }, { pdf: pdfFile.buffer.toString("base64"), png: photo.buffer.toString("base64") }) });
  await expect(page.getByRole("heading", { name: "Chọn trang cần nhập" })).toBeVisible();
  await page.getByLabel("Bắt đầu từ trang").fill("3");
  await page.getByRole("button", { name: "Nhập trang 3–22" }).click();
  await expect(page.locator(".panel-heading strong")).toHaveText("20/20", { timeout: 60_000 });
  await expect(page.locator(".live-message")).toContainText("nhập trang 3–22/22");
  await expect(page.locator(".live-message")).toContainText("anh.png: bỏ qua vì đã đủ 20 trang");
  await check();
});

test("editing can be undone and redone; the preview renders in the worker", async ({ page }) => {
  const check = await guard(page);
  const workerRequest = page.waitForRequest(/render-worker\.js\?v=/);
  await page.goto("./");
  await upload(page, "image/jpeg,image/png,image/webp", [{ name: "a.png", mimeType: "image/png", buffer: readFileSync(join(fixtures, "en-clean.png")) }]);
  await expect(page.locator(".live-message")).toContainText("Đã thêm 1 trang");
  // The preview is rendered by the worker and must finish.
  await expect(page.locator(".preview-status")).toHaveCount(0, { timeout: 60_000 });
  expect(await page.locator(".preview-document canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(100);
  await workerRequest;
  const undo = page.getByRole("button", { name: /Hoàn tác/ });
  const redo = page.getByRole("button", { name: /Làm lại/ });
  await expect(undo).toBeEnabled(); // the import itself can be undone
  await page.getByRole("button", { name: "Trắng đen" }).click();
  await expect(page.getByRole("button", { name: "Trắng đen" })).toHaveAttribute("aria-pressed", "true");
  await undo.click();
  await expect(page.getByRole("button", { name: "Ảnh gốc", exact: true })).toHaveAttribute("aria-pressed", "true");
  await redo.click();
  await expect(page.getByRole("button", { name: "Trắng đen" })).toHaveAttribute("aria-pressed", "true");
  await check();
});

test("OCR export can be cancelled while the engine is working", async ({ page }) => {
  const check = await guard(page);
  await page.goto("./");
  await upload(page, "image/jpeg,image/png,image/webp", [{ name: "bien-ban.jpg", mimeType: "image/jpeg", buffer: readFileSync(join(fixtures, "vi-clean.png")) }]);
  await expect(page.locator(".live-message")).toContainText("Đã thêm 1 trang");
  await page.getByRole("button", { name: /Tùy chọn & tải PDF/ }).click();
  await page.locator("dialog[open]").getByText("Word chỉnh sửa", { exact: true }).click();
  await page.getByRole("button", { name: "Tạo Word" }).click();
  await page.getByRole("button", { name: "Hủy xuất" }).click();
  await expect(page.locator(".live-message")).toContainText("Đã hủy xuất file");
  await expect(page.getByRole("button", { name: /Tùy chọn & tải Word/ })).toBeEnabled();
  await check();
});
