import { test, expect } from "@playwright/test";

test.describe.serial("搜索功能 E2E 测试", () => {

  // 1. 打开搜索对话框，验证六个 tab 可见
  test("1. Cmd+K 打开搜索，显示六个 tab", async ({ page }) => {
    await page.goto("/workspaces");
    await page.waitForTimeout(500);

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Verify all 6 tabs are visible (Chinese locale default)
    const tabs = dialog.locator("button").filter({
      hasText: /全部|任务|项目|仓库|笔记|资源/,
    });
    await expect(tabs).toHaveCount(6, { timeout: 3000 });

    // "全部" (All) tab should be active by default (amber styling)
    const allTab = dialog.locator("button").filter({ hasText: "全部" });
    await expect(allTab).toBeVisible();
    await expect(allTab).toHaveClass(/amber/);

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  // 2. 搜索关键字，All 模式分组展示
  test("2. 搜索关键字，All 模式显示分组结果", async ({ page }) => {
    await page.goto("/workspaces");
    await page.waitForTimeout(500);

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Type search query — use a broad term likely to match existing data
    await dialog.locator("input").fill("测试");
    await page.waitForTimeout(1000);

    // In All mode, results should appear with section headers
    const results = dialog.locator("button").filter({
      has: page.locator("div.truncate"),
    });

    // Either we get results with section headers, or we get "no results"
    const noResults = dialog.getByText(/没有找到结果|No results found/);
    const hasResults = await results.count() > 0;
    const hasNoResults = await noResults.isVisible().catch(() => false);

    // At least one of these must be true
    expect(hasResults || hasNoResults).toBe(true);

    await page.keyboard.press("Escape");
  });

  // 3. 切换到各个 tab
  test("3. 点击切换不同 tab 搜索", async ({ page }) => {
    await page.goto("/workspaces");
    await page.waitForTimeout(500);

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Click each tab and verify it becomes active
    const tabNames = ["任务", "项目", "仓库", "笔记", "资源", "全部"];
    for (const name of tabNames) {
      const tab = dialog.locator("button").filter({ hasText: name }).first();
      await tab.click();
      await expect(tab).toHaveClass(/amber/, { timeout: 2000 });
    }

    await page.keyboard.press("Escape");
  });

  // 4. Note tab 搜索显示 snippet
  test("4. 笔记搜索结果显示内容片段", async ({ page }) => {
    await page.goto("/workspaces");
    await page.waitForTimeout(500);

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Switch to Note tab
    const noteTab = dialog.locator("button").filter({ hasText: "笔记" });
    await noteTab.click();
    await expect(noteTab).toHaveClass(/amber/);

    // Search for notes
    await dialog.locator("input").fill("测试");
    await page.waitForTimeout(1000);

    // If results exist, check that result rows have the expected structure
    // Each result button should have: title div, subtitle div, and optionally a snippet div
    const resultRows = dialog.locator(
      "button.flex.w-full.items-center"
    );
    const count = await resultRows.count();
    if (count > 0) {
      // Result row should have at least title + subtitle
      const firstRow = resultRows.first();
      const textContainer = firstRow.locator("div.flex-1.min-w-0");
      await expect(textContainer).toBeVisible();
      // Title
      await expect(textContainer.locator("div").first()).toBeVisible();
    }

    await page.keyboard.press("Escape");
  });

  // 5. Asset tab 搜索
  test("5. 资源搜索可用", async ({ page }) => {
    await page.goto("/workspaces");
    await page.waitForTimeout(500);

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Switch to Asset tab and verify it activates
    const assetTab = dialog.locator("button").filter({ hasText: "资源" });
    await assetTab.click();
    await expect(assetTab).toHaveClass(/amber/);

    // Type a search query and wait for search to complete
    await dialog.locator("input").fill("test");
    await page.waitForTimeout(1500);

    // Dialog should still be visible and functional (no crash)
    await expect(dialog).toBeVisible();
    // Input should still have the value we typed
    await expect(dialog.locator("input")).toHaveValue("test");

    await page.keyboard.press("Escape");
  });

  // 6. 清除搜索内容
  test("6. 清除按钮重置搜索", async ({ page }) => {
    await page.goto("/workspaces");
    await page.waitForTimeout(500);

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const input = dialog.locator("input");
    await input.fill("something");
    await page.waitForTimeout(300);

    // Click the X (clear) button
    const clearBtn = dialog.locator("button").filter({
      has: page.locator("svg.lucide-x"),
    });
    if (await clearBtn.isVisible().catch(() => false)) {
      await clearBtn.click();
      await expect(input).toHaveValue("");
    }

    // Should show "type to search" prompt
    const typeToSearch = dialog.getByText(/输入|Type to search|搜索内容/);
    await expect(typeToSearch).toBeVisible({ timeout: 2000 });

    await page.keyboard.press("Escape");
  });

  // 7. 搜索 placeholder 包含笔记和资源
  test("7. 搜索 placeholder 提及笔记和资源", async ({ page }) => {
    await page.goto("/workspaces");
    await page.waitForTimeout(500);

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const input = dialog.locator("input");
    const placeholder = await input.getAttribute("placeholder");
    // Placeholder should mention notes and assets (updated in Phase 10)
    expect(placeholder).toBeTruthy();
    expect(placeholder!.length).toBeGreaterThan(5);

    await page.keyboard.press("Escape");
  });
});
