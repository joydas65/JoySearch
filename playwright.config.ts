import { defineConfig } from "@playwright/test";

// Always enter through the isolated runner. A direct Playwright invocation in a
// developer checkout could otherwise make Next load credential-bearing .env files.
if (process.env.JOYSEARCH_RELEASE_CHECK !== "1") {
  throw new Error("Run pnpm check:release to use the credential-free production test build.");
}

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  globalTimeout: 300_000,
  reporter: "list",
  outputDir: "test-results",
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:4173",
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/samples",
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
