import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests against the production static export served with the
 * production security headers, under the GitHub Pages base path.
 * Build first: STATIC_EXPORT=true BASE_PATH=/ak-scan npm run build (CI uses the Pages build).
 */
const port = 4173;
const basePath = process.env.E2E_BASE_PATH ?? "/ak-scan";
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}${basePath}/`,
    // Uses the Chrome installed on the machine/CI runner; no browser download.
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    acceptDownloads: true,
    serviceWorkers: "block",
  },
  webServer: {
    command: `node workflow/scripts/serve-static.mjs ${port} ${basePath}`,
    url: `http://localhost:${port}${basePath}/`,
    reuseExistingServer: !process.env.CI,
  },
});
