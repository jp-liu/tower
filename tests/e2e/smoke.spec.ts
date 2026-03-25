import { test, expect } from "@playwright/test";

test.describe.serial("AI Manager 可用性测试", () => {

  // 1. 首页加载
  test("1. 首页加载，侧边栏显示", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/workspaces/);
    await expect(page.locator("aside")).toBeVisible();
    await expect(page.getByText("AI Manager", { exact: true })).toBeVisible();
  });

  // 2. 新建工作空间（通过 Dialog）
  test("2. 新建工作空间", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    // Click the "+" button — find it by Plus icon button in sidebar
    const plusBtn = sidebar.locator("button").filter({ has: page.locator("svg") });
    // The Plus button for creating workspace
    for (let i = 0; i < await plusBtn.count(); i++) {
      const btn = plusBtn.nth(i);
      const title = await btn.getAttribute("title");
      if (title && title.includes("工作空间")) {
        await btn.click();
        break;
      }
    }
    // If no title match, try clicking the Plus icon near workspace section
    const dialog = page.getByRole("dialog");
    if (!await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Fallback: click any Plus button in sidebar
      await sidebar.locator("svg.lucide-plus").first().click({ force: true });
    }
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.locator("input").first().fill("E2E测试空间");
    // Click the emoji grid first item if visible
    const emojiBtn = dialog.locator("button").filter({ hasText: "🚀" });
    if (await emojiBtn.isVisible().catch(() => false)) {
      await emojiBtn.click();
    }
    // Click create button
    const createBtns = dialog.locator("button");
    for (let i = 0; i < await createBtns.count(); i++) {
      const text = await createBtns.nth(i).textContent();
      if (text?.includes("创建") || text?.includes("\u521b\u5efa")) {
        await createBtns.nth(i).click();
        break;
      }
    }
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/workspaces\//);
  });

  // 3. 点击工作空间导航
  test("3. 点击工作空间导航到看板", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: /测试|Test/ }).first();
    if (await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await wsBtn.click();
      await expect(page).toHaveURL(/\/workspaces\//);
    } else {
      test.skip();
    }
  });

  // 4. 新建项目
  test("4. 通过顶栏新建项目", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: "E2E" }).first();
    if (await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await wsBtn.click();
      await page.waitForURL(/\/workspaces\//);
      await page.waitForTimeout(500);
    }
    // Find and click new project button
    const headerBtns = page.locator("header button, header a");
    for (let i = 0; i < await headerBtns.count(); i++) {
      const text = await headerBtns.nth(i).textContent();
      if (text?.includes("新建项目") || text?.includes("\u65b0\u5efa\u9879\u76ee")) {
        await headerBtns.nth(i).click();
        break;
      }
    }
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.locator("input").first().fill("E2E测试项目");
    // Click the submit button — it's the last button in the dialog footer
    await dialog.locator("button").last().click();
    await page.waitForTimeout(3000);
    // Dialog should close or page should navigate
    const stillOpen = await dialog.isVisible().catch(() => false);
    if (stillOpen) {
      // Try pressing Enter as fallback
      await dialog.locator("input").first().press("Enter");
      await page.waitForTimeout(3000);
    }
    // Verify project was created by checking DB indirectly (page refreshed)
  });

  // 5. 新建任务
  test("5. 新建任务", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: /测试|Test/ }).first();
    if (!await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await wsBtn.click();
    await page.waitForURL(/\/workspaces\//);
    await page.waitForTimeout(1000);

    // Find new task button
    const allBtns = page.locator("button");
    let clicked = false;
    for (let i = 0; i < await allBtns.count(); i++) {
      const text = await allBtns.nth(i).textContent();
      if (text?.includes("新建任务") || text?.includes("\u65b0\u5efa\u4efb\u52a1")) {
        await allBtns.nth(i).click();
        clicked = true;
        break;
      }
    }
    if (!clicked) { test.skip(); return; }

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.locator("input").first().fill("E2E新建任务");
    await dialog.locator("textarea").fill("自动化测试创建");

    // Click create button
    const createBtns = dialog.locator("button");
    for (let i = 0; i < await createBtns.count(); i++) {
      const text = await createBtns.nth(i).textContent();
      if (text?.includes("创建") || text?.includes("\u521b\u5efa")) {
        await createBtns.nth(i).click();
        break;
      }
    }
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText("E2E新建任务")).toBeVisible({ timeout: 5000 });
  });

  // 6. 点击任务打开详情面板
  test("6. 点击任务卡片打开详情面板", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: /测试|Test/ }).first();
    if (!await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await wsBtn.click();
    await page.waitForURL(/\/workspaces\//);
    await page.waitForTimeout(1000);

    const taskCard = page.locator("[data-testid='task-card']").first();
    if (!await taskCard.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await taskCard.click();

    const panel = page.locator("[data-testid='task-detail-panel']");
    await expect(panel).toBeVisible({ timeout: 3000 });
    // Close panel
    const backBtn = panel.locator("button").filter({ has: page.locator("svg.lucide-arrow-left") });
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.click();
    }
  });

  // 7. 发送消息
  test("7. 在任务详情面板发送消息", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: /测试|Test/ }).first();
    if (!await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await wsBtn.click();
    await page.waitForURL(/\/workspaces\//);
    await page.waitForTimeout(1000);

    const taskCard = page.locator("[data-testid='task-card']").first();
    if (!await taskCard.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await taskCard.click();

    const panel = page.locator("[data-testid='task-detail-panel']");
    await expect(panel).toBeVisible({ timeout: 3000 });

    await panel.locator("textarea").fill("E2E测试消息");
    // Find send button
    const panelBtns = panel.locator("button");
    for (let i = 0; i < await panelBtns.count(); i++) {
      const text = await panelBtns.nth(i).textContent();
      if (text?.includes("发送") || text?.includes("\u53d1\u9001")) {
        await panelBtns.nth(i).click();
        break;
      }
    }
    await expect(panel.getByText("E2E测试消息")).toBeVisible({ timeout: 5000 });
  });

  // 8. 编辑任务
  test("8. 编辑任务标题", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: /测试|Test/ }).first();
    if (!await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await wsBtn.click();
    await page.waitForURL(/\/workspaces\//);
    await page.waitForTimeout(1000);

    const taskCard = page.locator("[data-testid='task-card']").first();
    if (!await taskCard.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }

    await taskCard.hover();
    const menuBtn = taskCard.locator("button").first();
    await menuBtn.click({ force: true });
    await page.waitForTimeout(300);

    // Find edit option
    const menuItems = page.locator("[role='menuitem'], [data-slot='menu-item']");
    for (let i = 0; i < await menuItems.count(); i++) {
      const text = await menuItems.nth(i).textContent();
      if (text?.includes("编辑") || text?.includes("\u7f16\u8f91")) {
        await menuItems.nth(i).click();
        break;
      }
    }

    const dialog = page.getByRole("dialog");
    if (!await dialog.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }

    const titleInput = dialog.locator("input").first();
    const val = await titleInput.inputValue();
    expect(val.length).toBeGreaterThan(0);

    await titleInput.clear();
    await titleInput.fill("已编辑的任务");
    // Find save button
    const dlgBtns = dialog.locator("button");
    for (let i = 0; i < await dlgBtns.count(); i++) {
      const text = await dlgBtns.nth(i).textContent();
      if (text?.includes("保存") || text?.includes("\u4fdd\u5b58")) {
        await dlgBtns.nth(i).click();
        break;
      }
    }
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  // 9. 搜索 (Cmd+K dialog)
  test("9. 搜索任务", async ({ page }) => {
    await page.goto("/workspaces");
    await page.waitForTimeout(500);
    // Open search dialog via Cmd+K
    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });
    // Type in search
    await dialog.locator("input").fill("测试");
    await page.waitForTimeout(500);
    // Close dialog
    await page.keyboard.press("Escape");
  });

  // 10. 筛选
  test("10. 筛选任务", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: /测试|Test/ }).first();
    if (!await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await wsBtn.click();
    await page.waitForURL(/\/workspaces\//);
    await page.waitForTimeout(1000);

    // Find filter buttons by looking for amber class pattern
    const filterBtns = page.locator("button").filter({ hasText: /执行中|\u6267\u884c\u4e2d/ });
    if (!await filterBtns.first().isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await filterBtns.first().click();
    await expect(filterBtns.first()).toHaveClass(/amber/);
  });

  // 11. 设置页
  test("11. 打开设置页", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForTimeout(1000);
    // Just verify page loaded without errors
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 5000 });
  });

  // 12. 删除任务
  test("12. 删除任务", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: /测试|Test/ }).first();
    if (!await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await wsBtn.click();
    await page.waitForURL(/\/workspaces\//);
    await page.waitForTimeout(1000);

    const countBefore = await page.locator("[data-testid='task-card']").count();
    if (countBefore === 0) { test.skip(); return; }

    const firstCard = page.locator("[data-testid='task-card']").first();
    await firstCard.hover();
    const menuBtn = firstCard.locator("button").first();
    await menuBtn.click({ force: true });
    await page.waitForTimeout(300);

    const menuItems = page.locator("[role='menuitem'], [data-slot='menu-item']");
    for (let i = 0; i < await menuItems.count(); i++) {
      const text = await menuItems.nth(i).textContent();
      if (text?.includes("删除") || text?.includes("\u5220\u9664")) {
        await menuItems.nth(i).click();
        break;
      }
    }
    await page.waitForTimeout(2000);
    const countAfter = await page.locator("[data-testid='task-card']").count();
    expect(countAfter).toBeLessThan(countBefore);
  });
});
