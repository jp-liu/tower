import { expect, test } from "@playwright/test";

test.describe("release smoke", () => {
  test("boots the packaged server and serves the primary routes", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/workspaces(?:\/|$)/);
    await expect(page.locator("aside")).toBeVisible();
    await expect(page.getByText("Tower", { exact: true })).toBeVisible();

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator("body")).not.toContainText(/设置用户名|Set Your Username/);
    await expect(page.locator("main")).toBeVisible();

    const missions = await page.goto("/missions");
    expect(missions?.status()).toBe(200);
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
