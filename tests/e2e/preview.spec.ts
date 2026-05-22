import { test, expect } from "@playwright/test";

// Full E2E for the preview feature requires:
//   1. Tower dev server running (pnpm dev) at the configured baseURL
//   2. Vite fixture deps installed: cd tests/fixtures/vite-project && pnpm install
//   3. Dev DB seeded with at least one workspace
//
// Until those preconditions are wired into CI / the playwright global setup,
// the heavy tests below are skipped. The first test verifies the spec file
// itself loads without import / setup errors.

test.describe("Preview feature (E2E)", () => {
  test("spec loads without errors", async ({ page: _page }) => {
    expect(true).toBe(true);
  });

  test.skip("vite project auto-detected, runs, shows iframe", async ({ page }) => {
    // TODO Phase 5 follow-up: enable when fixture + dev server are ready
    await page.goto("/");
    await expect(page.locator('[data-testid="preset-badge"]')).toContainText(/vite/i);
    await page.click('[data-testid="preview-run-button"]');
    await expect(page.locator('[data-testid="status-pill"]')).toContainText(/running/i, {
      timeout: 30_000,
    });
  });

  test.skip("preview state persists after closing task tab (long-lived PTY)", async () => {
    // TODO Phase 5 follow-up
  });

  test.skip("shared session: stop dialog appears when other tabs subscribed", async () => {
    // TODO Phase 5 follow-up
  });
});
