import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "ai-tools-0.3-final.spec.ts",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: process.env.AI_TOOLS_UI_OUTPUT_DIR,
  use: {
    browserName: "chromium",
    screenshot: "off",
    trace: "off",
  },
});
