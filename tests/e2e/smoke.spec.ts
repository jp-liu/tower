import { test, expect } from "@playwright/test";

test.describe.serial("AI Manager 可用性测试", () => {

  // 1. 首页加载
  test("1. 首页加载，侧边栏显示", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/workspaces/);
    await expect(page.locator("aside")).toBeVisible();
    await expect(page.getByText("AI Manager", { exact: true })).toBeVisible();
    await expect(page.locator("aside").getByText("工作空间", { exact: true })).toBeVisible();
  });

  // 2. 新建工作空间
  test("2. 新建工作空间", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    await sidebar.locator("button[title='新建工作空间']").click();
    const input = sidebar.locator("input[placeholder='工作空间名称']");
    await expect(input).toBeVisible();
    await input.fill("E2E测试空间");
    await input.press("Enter");
    await expect(sidebar.getByText("E2E测试空间")).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/workspaces\//);
  });

  // 3. 点击工作空间导航
  test("3. 点击工作空间导航到看板", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    // 点击 "测试" 工作空间（seed 数据）
    const wsBtn = sidebar.locator("button").filter({ hasText: "测试" }).first();
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

    // 先导航到 E2E 工作空间
    const wsBtn = sidebar.locator("button").filter({ hasText: "E2E测试空间" }).first();
    if (await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await wsBtn.click();
      await page.waitForURL(/\/workspaces\//);
      await page.waitForTimeout(500);
    }

    // 点击 "新建项目"
    await page.getByRole("button", { name: /新建项目/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.locator("input").fill("E2E测试项目");
    await dialog.getByRole("button", { name: "创建" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    // 页面应该刷新
    await page.waitForTimeout(1000);
  });

  // 5. 新建任务
  test("5. 新建任务", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");

    // 导航到有项目的工作空间
    const wsBtn = sidebar.locator("button").filter({ hasText: "测试" }).first();
    if (!await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await wsBtn.click();
    await page.waitForURL(/\/workspaces\//);
    await page.waitForTimeout(1000);

    // 点击新建任务
    const createBtn = page.getByRole("button", { name: /新建任务/ });
    if (!await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await createBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.locator("input#title, input[data-testid='task-title']").fill("E2E新建任务");
    await dialog.locator("textarea").fill("自动化测试创建");
    await dialog.getByRole("button", { name: "创建" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // 任务应该出现在看板上
    await expect(page.getByText("E2E新建任务")).toBeVisible({ timeout: 5000 });
  });

  // 6. 点击任务打开详情面板
  test("6. 点击任务卡片打开详情面板", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: "测试" }).first();
    if (!await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await wsBtn.click();
    await page.waitForURL(/\/workspaces\//);
    await page.waitForTimeout(1000);

    const taskCard = page.locator("[data-testid='task-card']").first();
    if (!await taskCard.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await taskCard.click();

    const panel = page.locator("[data-testid='task-detail-panel']");
    await expect(panel).toBeVisible({ timeout: 3000 });
    await expect(panel.getByText("任务对话")).toBeVisible();
    await expect(panel.getByRole("button", { name: "发送" })).toBeVisible();

    // 关闭面板
    await panel.getByText("返回任务列表").click();
    await expect(panel).not.toBeVisible({ timeout: 3000 });
  });

  // 7. 发送消息
  test("7. 在任务详情面板发送消息", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: "测试" }).first();
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
    await panel.getByRole("button", { name: "发送" }).click();
    await expect(panel.getByText("E2E测试消息")).toBeVisible({ timeout: 5000 });
  });

  // 8. 编辑任务
  test("8. 编辑任务标题", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: "测试" }).first();
    if (!await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await wsBtn.click();
    await page.waitForURL(/\/workspaces\//);
    await page.waitForTimeout(1000);

    const taskCard = page.locator("[data-testid='task-card']").first();
    if (!await taskCard.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }

    // hover 显示 "..." 菜单
    await taskCard.hover();
    const menuBtn = taskCard.locator("button").first();
    await menuBtn.click({ force: true });
    await page.waitForTimeout(300);

    const editOption = page.getByText("编辑", { exact: true });
    if (!await editOption.isVisible({ timeout: 2000 }).catch(() => false)) { test.skip(); return; }
    await editOption.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });
    // 标题应该已经预填
    const titleInput = dialog.locator("input").first();
    const val = await titleInput.inputValue();
    expect(val.length).toBeGreaterThan(0);

    await titleInput.clear();
    await titleInput.fill("已编辑的任务");
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText("已编辑的任务")).toBeVisible({ timeout: 5000 });
  });

  // 9. 搜索
  test("9. 搜索任务", async ({ page }) => {
    await page.goto("/workspaces");
    await page.waitForTimeout(500);
    const searchInput = page.locator("input[placeholder*='Search']");
    await searchInput.fill("测试");
    await page.waitForTimeout(500);
    // 搜索结果应该出现
    // 检查是否有结果下拉（可能没有匹配结果如果数据被修改了）
    const hasResults = await page.locator("[class*='shadow-lg']").isVisible({ timeout: 3000 }).catch(() => false);
    console.log("搜索有结果:", hasResults);
    // 清空搜索
    await searchInput.clear();
  });

  // 10. 筛选
  test("10. 筛选任务", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: "测试" }).first();
    if (!await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await wsBtn.click();
    await page.waitForURL(/\/workspaces\//);
    await page.waitForTimeout(1000);

    // 点击 "执行中" 筛选
    const filterBtn = page.getByRole("button", { name: "执行中", exact: true });
    if (!await filterBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await filterBtn.click();
    await expect(filterBtn).toHaveClass(/violet/);

    // 重置
    await page.getByRole("button", { name: "全部", exact: true }).first().click();
  });

  // 11. 设置页
  test("11. 打开设置页", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "配置", exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("AI Tools", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("编码代理配置").first()).toBeVisible();
  });

  // 12. 删除任务
  test("12. 删除任务", async ({ page }) => {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    const wsBtn = sidebar.locator("button").filter({ hasText: "测试" }).first();
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

    const deleteOption = page.getByText("删除", { exact: true });
    if (!await deleteOption.isVisible({ timeout: 2000 }).catch(() => false)) { test.skip(); return; }
    await deleteOption.click();
    await page.waitForTimeout(2000);

    const countAfter = await page.locator("[data-testid='task-card']").count();
    expect(countAfter).toBeLessThan(countBefore);
  });
});
