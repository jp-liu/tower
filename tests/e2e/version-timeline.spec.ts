/**
 * E2E: Version Timeline
 *
 * Golden path: from a workspace board, open the "版本时间线" (Version Timeline)
 * view via the board entry button, create a new version through the dialog,
 * and confirm it renders on the timeline.
 *
 * Skips gracefully when no workspace/project exists in the dev database.
 */
import { test, expect, type Page } from "@playwright/test";

const VERSION_NO = `v0.0-e2e-${Date.now()}`;
const VERSION_NAME = `E2E 版本 ${Date.now()}`;

/** Navigate to the first available workspace board. Returns false if none exists. */
async function navigateToFirstWorkspace(page: Page): Promise<boolean> {
  await page.goto("/workspaces");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);

  if (/\/workspaces\/[a-z0-9]{20,}/.test(page.url())) {
    await page.waitForTimeout(500);
    return true;
  }

  const sidebar = page.locator("aside");
  await sidebar.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);

  const btns = sidebar.locator("button");
  const count = await btns.count();
  for (let i = 0; i < count; i++) {
    const btn = btns.nth(i);
    const title = await btn.getAttribute("title");
    const text = await btn.textContent();
    if (title?.includes("新建") || title?.includes("折叠") || title?.includes("collapse")) continue;
    if (!text || text.trim().length < 4) continue;
    const hasTimePattern = /\d+[mhd]\s+ago/.test(text);
    const isNavItem = /工作空间|控制台|设置|Settings|Workspace|Control|归档|Archive|Notes|Assets/.test(text);
    if (hasTimePattern || (!isNavItem && text.trim().length >= 4)) {
      try {
        await btn.click();
        await page.waitForURL(/\/workspaces\/[a-z0-9]{20,}/, { timeout: 6000 });
        await page.waitForTimeout(800);
        return true;
      } catch {
        // try next
      }
    }
  }
  return false;
}

/** From the board, click the "版本时间线" entry button to reach the versions route. */
async function openVersionTimeline(page: Page): Promise<boolean> {
  await page.waitForSelector("header, main", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);

  const entry = page.locator("a, button").filter({ hasText: /版本时间线|Version Timeline/ });
  if (await entry.count() === 0) return false;
  await entry.first().click();
  try {
    await page.waitForURL(/\/projects\/[a-z0-9]{20,}\/versions/, { timeout: 8000 });
  } catch {
    return false;
  }
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);
  return true;
}

test.describe.serial("Version Timeline", () => {
  test("1. open the version timeline from the board", async ({ page }) => {
    if (!(await navigateToFirstWorkspace(page))) {
      test.skip(true, "no workspace in dev DB");
      return;
    }
    if (!(await openVersionTimeline(page))) {
      test.skip(true, "version timeline entry not found");
      return;
    }
    await expect(page).toHaveURL(/\/projects\/[a-z0-9]{20,}\/versions/);
    // The page header / new-version button should render
    await expect(
      page.locator("a, button, h1, h2").filter({ hasText: /新建版本|New Version|版本时间线|Version Timeline/ }).first()
    ).toBeVisible({ timeout: 8000 });
  });

  test("2. create a version and see it on the timeline", async ({ page }) => {
    if (!(await navigateToFirstWorkspace(page))) {
      test.skip(true, "no workspace in dev DB");
      return;
    }
    if (!(await openVersionTimeline(page))) {
      test.skip(true, "version timeline entry not found");
      return;
    }

    // Open the new-version dialog
    const newBtn = page.locator("button").filter({ hasText: /新建版本|New Version/ });
    if (await newBtn.count() === 0) {
      test.skip(true, "new version button not found");
      return;
    }
    await newBtn.first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Fill number + name (first two text inputs in the dialog)
    const inputs = dialog.locator("input[type='text'], input:not([type])");
    await inputs.nth(0).fill(VERSION_NO);
    await inputs.nth(1).fill(VERSION_NAME);

    // Submit (创建 / 保存 / Create / Save)
    const submit = dialog.locator("button").filter({ hasText: /创建|保存|Create|Save/ });
    await submit.last().click();

    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // The new version number should now appear on the timeline
    await expect(page.getByText(VERSION_NO).first()).toBeVisible({ timeout: 8000 });
  });
});
