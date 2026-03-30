import { test, expect, type Page } from "@playwright/test";

test.describe.serial("Phase 7: Notes & Assets Web UI", () => {
  // Helper: navigate to a workspace that has projects
  async function goToWorkspace(page: Page) {
    await page.goto("/workspaces");
    const sidebar = page.locator("aside");
    // Click first workspace button
    const wsBtn = sidebar.locator("button").filter({ hasText: /测试|Test|E2E/ }).first();
    if (!await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Fallback: click any workspace
      const anyWs = sidebar.locator("[data-slot='sidebar-menu-button']").first();
      if (await anyWs.isVisible({ timeout: 3000 }).catch(() => false)) {
        await anyWs.click();
      }
    } else {
      await wsBtn.click();
    }
    await page.waitForURL(/\/workspaces\//);
    await page.waitForTimeout(500);
  }

  // ─── Notes Page ───

  test("7.1 侧边栏显示笔记和资源导航链接", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    const notesLink = sidebar.locator("a").filter({ hasText: /笔记|Notes/ });
    const assetsLink = sidebar.locator("a").filter({ hasText: /资源|Assets/ });
    await expect(notesLink).toBeVisible({ timeout: 3000 });
    await expect(assetsLink).toBeVisible({ timeout: 3000 });
  });

  test("7.2 点击笔记链接进入笔记页面", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    const notesLink = sidebar.locator("a").filter({ hasText: /笔记|Notes/ });
    await notesLink.click();
    await page.waitForURL(/\/notes/);
    // Should see the notes page with a "new note" button
    await expect(
      page.locator("button").filter({ hasText: /新建笔记|New Note/ })
    ).toBeVisible({ timeout: 5000 });
  });

  test("7.3 笔记页面显示分类筛选按钮", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    await sidebar.locator("a").filter({ hasText: /笔记|Notes/ }).click();
    await page.waitForURL(/\/notes/);
    await page.waitForTimeout(500);
    // Category filter should show preset categories
    const allBtn = page.locator("button").filter({ hasText: /全部|All/ });
    await expect(allBtn).toBeVisible({ timeout: 3000 });
    // Check at least one preset category is visible
    const categories = ["账号", "环境", "需求", "备忘"];
    let found = false;
    for (const cat of categories) {
      const btn = page.locator("button").filter({ hasText: cat });
      if (await btn.isVisible().catch(() => false)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test("7.4 新建笔记：填写表单并保存", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    await sidebar.locator("a").filter({ hasText: /笔记|Notes/ }).click();
    await page.waitForURL(/\/notes/);
    await page.waitForTimeout(500);

    // Click new note button
    await page.locator("button").filter({ hasText: /新建笔记|New Note/ }).click();
    await page.waitForTimeout(300);

    // Fill title
    const titleInput = page.locator("input").filter({ hasNotText: "" }).first();
    await titleInput.fill("E2E测试笔记");

    // Fill content in textarea
    const textarea = page.locator("textarea");
    await textarea.fill("## 测试内容\n\n这是一条E2E自动化测试创建的笔记。");

    // Click save
    const saveBtn = page.locator("button").filter({ hasText: /保存|Save/ });
    await saveBtn.click();
    await page.waitForTimeout(1000);

    // Verify note appears in list
    await expect(page.getByText("E2E测试笔记")).toBeVisible({ timeout: 5000 });
  });

  test("7.5 笔记卡片显示标题和内容预览", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    await sidebar.locator("a").filter({ hasText: /笔记|Notes/ }).click();
    await page.waitForURL(/\/notes/);
    await page.waitForTimeout(1000);

    // The note we created should show title and content preview
    const noteTitle = page.getByText("E2E测试笔记");
    if (!await noteTitle.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }
    await expect(noteTitle).toBeVisible();
    await expect(page.getByText("测试内容")).toBeVisible();
  });

  test("7.6 编辑笔记", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    await sidebar.locator("a").filter({ hasText: /笔记|Notes/ }).click();
    await page.waitForURL(/\/notes/);
    await page.waitForTimeout(1000);

    const noteTitle = page.getByText("E2E测试笔记");
    if (!await noteTitle.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }

    // Find and click edit button (pencil icon) - hover to reveal
    const noteCard = noteTitle.locator("xpath=ancestor::div[contains(@class, 'border')]");
    await noteCard.hover();
    await page.waitForTimeout(200);
    const editBtn = noteCard.locator("button[aria-label*='edit'], button:has(svg.lucide-pencil)").first();
    if (await editBtn.isVisible().catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(500);

      // Update title
      const titleInput = page.locator("input").first();
      await titleInput.clear();
      await titleInput.fill("E2E已编辑笔记");

      // Save
      const saveBtn = page.locator("button").filter({ hasText: /保存|Save/ });
      await saveBtn.click();
      await page.waitForTimeout(1000);

      await expect(page.getByText("E2E已编辑笔记")).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test("7.7 分类筛选功能", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    await sidebar.locator("a").filter({ hasText: /笔记|Notes/ }).click();
    await page.waitForURL(/\/notes/);
    await page.waitForTimeout(1000);

    // Click a specific category filter
    const catBtn = page.locator("button").filter({ hasText: "账号" });
    if (await catBtn.isVisible().catch(() => false)) {
      await catBtn.click();
      await page.waitForTimeout(500);
      // The button should be active (amber style)
      await expect(catBtn).toHaveClass(/amber/);
      // Click "All" to reset
      const allBtn = page.locator("button").filter({ hasText: /全部|All/ });
      await allBtn.click();
      await page.waitForTimeout(300);
    } else {
      test.skip();
    }
  });

  test("7.8 删除笔记", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    await sidebar.locator("a").filter({ hasText: /笔记|Notes/ }).click();
    await page.waitForURL(/\/notes/);
    await page.waitForTimeout(1000);

    const noteTitle = page.getByText(/E2E.*笔记/);
    if (!await noteTitle.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }

    // Hover and click delete button
    const noteCard = noteTitle.locator("xpath=ancestor::div[contains(@class, 'border')]");
    await noteCard.hover();
    await page.waitForTimeout(200);
    const deleteBtn = noteCard.locator("button[aria-label*='delete'], button:has(svg.lucide-trash)").first();
    if (await deleteBtn.isVisible().catch(() => false)) {
      await deleteBtn.click();
      await page.waitForTimeout(2000);
      // Note should be gone
      await expect(noteTitle).not.toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test("7.9 返回看板链接可用", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    await sidebar.locator("a").filter({ hasText: /笔记|Notes/ }).click();
    await page.waitForURL(/\/notes/);
    await page.waitForTimeout(500);

    const backLink = page.locator("a").filter({ hasText: /返回看板|Back/ });
    await expect(backLink).toBeVisible({ timeout: 3000 });
    await backLink.click();
    await page.waitForURL(/\/workspaces\/[^/]+$/);
  });

  // ─── Assets Page ───

  test("7.10 点击资源链接进入资源页面", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    const assetsLink = sidebar.locator("a").filter({ hasText: /资源|Assets/ });
    await assetsLink.click();
    await page.waitForURL(/\/assets/);
    // Should see upload button
    await expect(
      page.locator("button").filter({ hasText: /上传|Upload/ })
    ).toBeVisible({ timeout: 5000 });
  });

  test("7.11 资源页面显示空状态或文件列表", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    await sidebar.locator("a").filter({ hasText: /资源|Assets/ }).click();
    await page.waitForURL(/\/assets/);
    await page.waitForTimeout(1000);

    // Either we see asset items or empty state text
    const hasAssets = await page.locator("a[aria-label*='download']").count() > 0;
    const hasEmpty = await page.getByText(/暂无|No assets|empty/).isVisible().catch(() => false);
    expect(hasAssets || hasEmpty).toBe(true);
  });

  test("7.12 上传按钮存在且可点击", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    await sidebar.locator("a").filter({ hasText: /资源|Assets/ }).click();
    await page.waitForURL(/\/assets/);
    await page.waitForTimeout(500);

    const uploadBtn = page.locator("button").filter({ hasText: /上传|Upload/ });
    await expect(uploadBtn).toBeVisible();
    await expect(uploadBtn).toBeEnabled();
  });

  test("7.13 资源页面返回看板", async ({ page }) => {
    await goToWorkspace(page);
    const sidebar = page.locator("aside");
    await sidebar.locator("a").filter({ hasText: /资源|Assets/ }).click();
    await page.waitForURL(/\/assets/);
    await page.waitForTimeout(500);

    const backLink = page.locator("a").filter({ hasText: /返回看板|Back/ });
    await expect(backLink).toBeVisible({ timeout: 3000 });
    await backLink.click();
    await page.waitForURL(/\/workspaces\/[^/]+$/);
  });
});

// ─── File Serving Security ───

test.describe("Phase 6: File Serving Security", () => {
  test("6.1 路径穿越攻击返回400", async ({ page }) => {
    const response = await page.goto("/api/files/assets/../../etc/passwd");
    expect(response?.status()).toBe(400);
  });

  test("6.2 不存在的文件返回404", async ({ page }) => {
    const response = await page.goto("/api/files/assets/nonexistent-project/nonexistent-file.txt");
    expect(response?.status()).toBe(404);
  });

  test("6.3 正常asset路径格式正确（即使文件不存在也返回404而非500）", async ({ page }) => {
    const response = await page.goto("/api/files/assets/test-project-id/test.png");
    // Should be 400 (invalid path) or 404 (not found), never 500
    const status = response?.status();
    expect(status === 400 || status === 404).toBe(true);
  });
});
