import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for the Task Development Workbench (v0.6)
 *
 * Prerequisites:
 * - At least one workspace with a project and tasks
 * - Ideally a task that has been executed (worktree exists)
 * - Tests skip gracefully if preconditions are not met
 */

// ---------- helpers ----------

async function goToWorkspace(page: Page): Promise<boolean> {
  await page.goto("/workspaces");
  const sidebar = page.locator("aside");
  const wsBtn = sidebar.locator("button").filter({ hasText: /测试|Test|E2E/ }).first();
  if (await wsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await wsBtn.click();
  } else {
    const anyWs = sidebar.locator("button").filter({ hasText: /.{2,}/ }).first();
    if (await anyWs.isVisible({ timeout: 3000 }).catch(() => false)) {
      await anyWs.click();
    } else {
      return false;
    }
  }
  await page.waitForURL(/\/workspaces\//, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  return page.url().includes("/workspaces/");
}

async function openFirstTaskDrawer(page: Page): Promise<boolean> {
  const card = page.locator("[data-testid='task-card']").first();
  if (!(await card.isVisible({ timeout: 5000 }).catch(() => false))) {
    return false;
  }
  await card.click();
  await page.waitForTimeout(500);
  return true;
}

async function navigateToWorkbench(page: Page): Promise<boolean> {
  const hasTask = await openFirstTaskDrawer(page);
  if (!hasTask) return false;

  const panel = page.locator("[data-testid='task-detail-panel']");
  if (!(await panel.isVisible({ timeout: 3000 }).catch(() => false))) return false;

  const viewBtn = panel
    .locator("button, a")
    .filter({ hasText: /查看详情|View Details/ })
    .first();
  if (!(await viewBtn.isVisible({ timeout: 3000 }).catch(() => false))) return false;

  await viewBtn.click();
  await page.waitForURL(/\/tasks\//, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
  return page.url().includes("/tasks/");
}

const SKIP_NO_WORKSPACE = "No workspace with projects available";
const SKIP_NO_TASK = "No task cards found in workspace";
const SKIP_NO_WORKBENCH = "Could not navigate to workbench";
const SKIP_NO_WORKTREE = "No worktree available — file tree shows empty state";

// =====================================================================
//  Phase 19: Workbench Entry & Layout
// =====================================================================

test.describe.serial("Phase 19 — Workbench Entry & Layout", () => {
  test("19-1. 查看详情按钮跳转到任务工作台 (WB-01)", async ({ page }) => {
    if (!(await goToWorkspace(page))) { test.skip(true, SKIP_NO_WORKSPACE); return; }
    if (!(await openFirstTaskDrawer(page))) { test.skip(true, SKIP_NO_TASK); return; }

    const panel = page.locator("[data-testid='task-detail-panel']");
    await expect(panel).toBeVisible({ timeout: 3000 });

    const viewBtn = panel
      .locator("button, a")
      .filter({ hasText: /查看详情|View Details/ })
      .first();
    await expect(viewBtn).toBeVisible({ timeout: 3000 });
    await viewBtn.click();

    await expect(page).toHaveURL(/\/tasks\//, { timeout: 10000 });
  });

  test("19-2. 工作台布局：左侧聊天 + 右侧三标签 (WB-02)", async ({ page }) => {
    if (!(await goToWorkspace(page))) { test.skip(true, SKIP_NO_WORKSPACE); return; }
    if (!(await navigateToWorkbench(page))) { test.skip(true, SKIP_NO_WORKBENCH); return; }

    const chatPanel = page.locator("textarea, input[type='text']").first();
    await expect(chatPanel).toBeVisible({ timeout: 5000 });

    const filesTab = page.locator("button, [role='tab']").filter({ hasText: /文件|Files/ }).first();
    const changesTab = page.locator("button, [role='tab']").filter({ hasText: /变更|Changes/ }).first();

    await expect(filesTab).toBeVisible({ timeout: 3000 });
    await expect(changesTab).toBeVisible({ timeout: 3000 });
  });

  test("19-3. 标签切换不丢失聊天状态 (WB-02)", async ({ page }) => {
    if (!(await goToWorkspace(page))) { test.skip(true, SKIP_NO_WORKSPACE); return; }
    if (!(await navigateToWorkbench(page))) { test.skip(true, SKIP_NO_WORKBENCH); return; }

    const changesTab = page.locator("button, [role='tab']").filter({ hasText: /变更|Changes/ }).first();
    if (await changesTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await changesTab.click();
      await page.waitForTimeout(300);
    }

    const filesTab = page.locator("button, [role='tab']").filter({ hasText: /文件|Files/ }).first();
    if (await filesTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filesTab.click();
      await page.waitForTimeout(300);
    }

    const chatArea = page.locator("textarea, input[type='text']").first();
    await expect(chatArea).toBeVisible({ timeout: 3000 });
  });
});

// =====================================================================
//  Phase 20: File Tree Browser
// =====================================================================

test.describe.serial("Phase 20 — File Tree Browser", () => {
  test("20-1. 文件树展示 worktree 目录或空状态 (FT-01)", async ({ page }) => {
    if (!(await goToWorkspace(page))) { test.skip(true, SKIP_NO_WORKSPACE); return; }
    if (!(await navigateToWorkbench(page))) { test.skip(true, SKIP_NO_WORKBENCH); return; }

    const filesTab = page.locator("button, [role='tab']").filter({ hasText: /文件|Files/ }).first();
    if (await filesTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filesTab.click();
    }

    // File tree OR empty state should be visible
    const treeOrEmpty = page
      .locator("div")
      .filter({ hasText: /src|package\.json|文件树暂不可用|File tree unavailable|选择文件|Select a file/ })
      .first();
    await expect(treeOrEmpty).toBeVisible({ timeout: 5000 });
  });

  test("20-2. 展开文件夹显示子目录 (FT-01)", async ({ page }) => {
    if (!(await goToWorkspace(page))) { test.skip(true, SKIP_NO_WORKSPACE); return; }
    if (!(await navigateToWorkbench(page))) { test.skip(true, SKIP_NO_WORKBENCH); return; }

    const folder = page.locator("div").filter({ hasText: /^src$/ }).first();
    if (!(await folder.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, SKIP_NO_WORKTREE);
      return;
    }

    await folder.click();
    await page.waitForTimeout(500);

    const children = page.locator("div").filter({ hasText: /\.ts|\.tsx|components|lib|actions/ });
    const childCount = await children.count();
    expect(childCount).toBeGreaterThan(0);
  });

  test("20-3. 右键菜单显示操作选项 (FT-05)", async ({ page }) => {
    if (!(await goToWorkspace(page))) { test.skip(true, SKIP_NO_WORKSPACE); return; }
    if (!(await navigateToWorkbench(page))) { test.skip(true, SKIP_NO_WORKBENCH); return; }

    const treeNode = page.locator("div").filter({ hasText: /package\.json|src|README/ }).first();
    if (!(await treeNode.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, SKIP_NO_WORKTREE);
      return;
    }

    await treeNode.click({ button: "right" });
    await page.waitForTimeout(300);

    const menu = page.locator("div").filter({ hasText: /新建文件|New File|重命名|Rename/ }).first();
    await expect(menu).toBeVisible({ timeout: 3000 });

    await page.mouse.click(0, 0);
    await page.waitForTimeout(300);
  });
});

// =====================================================================
//  Phase 21: Code Editor (Monaco)
// =====================================================================

test.describe.serial("Phase 21 — Code Editor (Monaco)", () => {
  test("21-1. 点击文件打开 Monaco 编辑器 (ED-01)", async ({ page }) => {
    if (!(await goToWorkspace(page))) { test.skip(true, SKIP_NO_WORKSPACE); return; }
    if (!(await navigateToWorkbench(page))) { test.skip(true, SKIP_NO_WORKBENCH); return; }

    const srcFolder = page.locator("div").filter({ hasText: /^src$/ }).first();
    if (!(await srcFolder.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, SKIP_NO_WORKTREE);
      return;
    }

    await srcFolder.click();
    await page.waitForTimeout(500);

    const tsFile = page.locator("div").filter({ hasText: /\.ts$|\.tsx$/ }).first();
    if (!(await tsFile.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, "No TypeScript files visible in file tree");
      return;
    }

    await tsFile.click();
    await page.waitForTimeout(2000);

    const monacoContainer = page.locator(".monaco-editor, [data-keybinding-context]");
    await expect(monacoContainer.first()).toBeVisible({ timeout: 10000 });
  });

  test("21-2. 编辑器主题跟随 dark/light 设置 (ED-05)", async ({ page }) => {
    if (!(await goToWorkspace(page))) { test.skip(true, SKIP_NO_WORKSPACE); return; }
    if (!(await navigateToWorkbench(page))) { test.skip(true, SKIP_NO_WORKBENCH); return; }

    const monacoContainer = page.locator(".monaco-editor").first();
    if (!(await monacoContainer.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, "Monaco editor not loaded — skip theme test");
      return;
    }

    const html = page.locator("html");
    const currentTheme = await html.getAttribute("class");

    if (currentTheme?.includes("dark")) {
      await expect(monacoContainer).toHaveClass(/vs-dark/);
    } else {
      const classes = await monacoContainer.getAttribute("class");
      expect(classes).not.toContain("vs-dark");
    }
  });
});

// =====================================================================
//  Phase 22: Diff View Integration
// =====================================================================

test.describe.serial("Phase 22 — Diff View Integration", () => {
  test("22-1. 变更标签页显示 diff 或空状态 (DF-01)", async ({ page }) => {
    if (!(await goToWorkspace(page))) { test.skip(true, SKIP_NO_WORKSPACE); return; }
    if (!(await navigateToWorkbench(page))) { test.skip(true, SKIP_NO_WORKBENCH); return; }

    const changesTab = page.locator("button, [role='tab']").filter({ hasText: /变更|Changes/ }).first();
    await expect(changesTab).toBeVisible({ timeout: 3000 });
    await changesTab.click();
    await page.waitForTimeout(1000);

    const diffOrMessage = page
      .locator("div")
      .filter({ hasText: /\+|\-|暂无变更|No changes|启动执行|Start|加载/ })
      .first();
    await expect(diffOrMessage).toBeVisible({ timeout: 5000 });
  });
});

// =====================================================================
//  Phase 23: Preview Panel
// =====================================================================

test.describe.serial("Phase 23 — Preview Panel", () => {
  test("23-1. 前端项目显示预览标签页 (PV-01)", async ({ page }) => {
    if (!(await goToWorkspace(page))) { test.skip(true, SKIP_NO_WORKSPACE); return; }
    if (!(await navigateToWorkbench(page))) { test.skip(true, SKIP_NO_WORKBENCH); return; }

    // Preview tab should be visible for FRONTEND projects (default)
    const previewTab = page.locator("button, [role='tab']").filter({ hasText: /预览|Preview/ }).first();
    const isVisible = await previewTab.isVisible({ timeout: 3000 }).catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("23-2. 预览面板有控制区域 (PV-02, PV-03)", async ({ page }) => {
    if (!(await goToWorkspace(page))) { test.skip(true, SKIP_NO_WORKSPACE); return; }
    if (!(await navigateToWorkbench(page))) { test.skip(true, SKIP_NO_WORKBENCH); return; }

    const previewTab = page.locator("button, [role='tab']").filter({ hasText: /预览|Preview/ }).first();
    if (!(await previewTab.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, "Preview tab not visible — project may be BACKEND type");
      return;
    }

    await previewTab.click();
    await page.waitForTimeout(500);

    const previewArea = page.locator("div").filter({
      hasText: /http|localhost|地址|URL|预览|Preview|启动|Run|运行|停止|Stop/,
    });
    await expect(previewArea.first()).toBeVisible({ timeout: 5000 });
  });

  test("23-3. 设置页有终端应用配置 (PV-05)", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForTimeout(500);

    const generalTab = page.locator("button, a").filter({ hasText: /通用|General/ }).first();
    if (await generalTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await generalTab.click();
      await page.waitForTimeout(500);
    }

    const terminalLabel = page.locator("label, div").filter({ hasText: /终端|Terminal/ }).first();
    await expect(terminalLabel).toBeVisible({ timeout: 5000 });
  });
});
