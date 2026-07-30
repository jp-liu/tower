import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const E2E_RUN_ID = (process.env.TOWER_E2E_RUN_ID || "local").replace(
  /[^a-zA-Z0-9_-]/g,
  "-",
);
const numericRunId = Number.parseInt(E2E_RUN_ID, 10);
const E2E_PORT = Number(
  process.env.TOWER_E2E_PORT ||
    (Number.isFinite(numericRunId)
      ? String(19_000 + (numericRunId % 10_000))
      : "19322"),
);
const E2E_DATA_DIR = path.join(os.tmpdir(), `tower-e2e-${E2E_RUN_ID}`);
const E2E_DATABASE_URL = `file:${path.join(E2E_DATA_DIR, "database", "tower.db")}`;

// The web server and Playwright workers must share one disposable root. Never
// inherit ~/.tower, ~/.tower-dev, or an already-running localhost:3000 service.
process.env.TOWER_DATA_DIR = E2E_DATA_DIR;
process.env.DATABASE_URL = E2E_DATABASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  retries: 0,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: {
    command: `node scripts/prepare-e2e-db.mjs && node bin/tower.mjs start --host 127.0.0.1 --port ${E2E_PORT} --no-open`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AI_CODING_ENABLED: "false",
      DATABASE_URL: E2E_DATABASE_URL,
      NO_PROXY: "localhost,127.0.0.1",
      TOWER_DATA_DIR: E2E_DATA_DIR,
      TOWER_NO_OPEN: "1",
      no_proxy: "localhost,127.0.0.1",
    },
  },
});
