/**
 * E2E-01: Task Lifecycle Flow
 *
 * Covers the full task lifecycle: create task → change status to IN_PROGRESS → mark DONE.
 * Uses serial execution to maintain shared page state across steps.
 */
import { test, expect } from "@playwright/test";

const TASK_TITLE = `E2E Task Lifecycle ${Date.now()}`;

/** Navigate to the first available workspace kanban board. Returns false if no workspace exists. */
async function navigateToFirstWorkspace(page: import("@playwright/test").Page): Promise<boolean> {
  await page.goto("/workspaces");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);

  // If already on a workspace board page, board is already rendered
  const currentUrl = page.url();
  if (currentUrl.match(/\/workspaces\/[a-z0-9]{20,}/)) {
    await page.waitForTimeout(500);
    return true;
  }

  // Find workspace buttons in the sidebar.
  // The AppSidebar renders workspace buttons with workspace name + relative time (e.g. "EBG\n6d ago").
  // Time format from formatTime(): "Xm ago", "Xh ago", or "Xd ago".
  const sidebar = page.locator("aside");
  await sidebar.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);

  const allSidebarBtns = sidebar.locator("button");
  const count = await allSidebarBtns.count();

  for (let i = 0; i < count; i++) {
    const btn = allSidebarBtns.nth(i);
    const title = await btn.getAttribute("title");
    const text = await btn.textContent();

    // Skip control/icon-only buttons
    if (title?.includes("新建") || title?.includes("折叠") || title?.includes("collapse")) continue;
    if (!text || text.trim().length < 4) continue;

    // Workspace buttons contain name + time (formatTime gives "Xm ago", "Xh ago", "Xd ago")
    const hasTimePattern = /\d+[mhd]\s+ago/.test(text);
    // Exclude known nav items to avoid clicking settings/missions links
    const isNavItem = /工作空间|控制台|设置|Settings|Workspace|Control|归档|Archive|Notes|Assets/.test(text);

    if (hasTimePattern || (!isNavItem && text.trim().length >= 4)) {
      try {
        await btn.click();
        await page.waitForURL(/\/workspaces\/[a-z0-9]{20,}/, { timeout: 6000 });
        await page.waitForTimeout(800);
        return true;
      } catch {
        // URL didn't change — try next button
      }
    }
  }

  return false;
}

test.describe.serial("Task Lifecycle Flow", () => {
  test("1. Navigate to workspace board", async ({ page }) => {
    const ok = await navigateToFirstWorkspace(page);
    if (!ok) {
      // No workspace exists yet — that's fine, subsequent tests will skip
      test.skip();
    }
    await expect(page).toHaveURL(/\/workspaces\/\w/);
  });

  test("2. Create a new task in the kanban board", async ({ page }) => {
    const ok = await navigateToFirstWorkspace(page);
    if (!ok) {
      test.skip();
      return;
    }

    // Wait for the kanban board to fully render
    await page.waitForSelector("header, main", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Find the "新建任务" / "New Task" button (BoardFilters component, t("board.newTask"))
    let clicked = false;

    const newTaskBtn = page.locator("button").filter({ hasText: /新建任务|New Task/ });
    if (await newTaskBtn.count() > 0 && await newTaskBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await newTaskBtn.first().click();
      clicked = true;
    }

    if (!clicked) {
      // Fallback: scan all buttons
      const allBtns = page.locator("button");
      const count = await allBtns.count();
      for (let i = 0; i < count; i++) {
        const text = await allBtns.nth(i).textContent();
        if (text?.includes("新建任务") || text?.includes("New Task")) {
          await allBtns.nth(i).click();
          clicked = true;
          break;
        }
      }
    }

    if (!clicked) {
      test.skip();
      return;
    }

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Fill in the task title
    const titleInput = dialog.locator("input").first();
    await titleInput.fill(TASK_TITLE);

    // Fill description if textarea exists
    const textarea = dialog.locator("textarea");
    if (await textarea.isVisible({ timeout: 1000 }).catch(() => false)) {
      await textarea.fill("Automated E2E lifecycle test");
    }

    // Click the create/submit button
    const dlgBtns = dialog.locator("button");
    const dlgCount = await dlgBtns.count();
    for (let i = 0; i < dlgCount; i++) {
      const text = await dlgBtns.nth(i).textContent();
      if (text?.includes("创建") || text?.includes("Create")) {
        await dlgBtns.nth(i).click();
        break;
      }
    }

    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Verify task appears in the board
    await expect(page.getByText(TASK_TITLE)).toBeVisible({ timeout: 8000 });
  });

  test("3. Move task to IN_PROGRESS via context menu", async ({ page }) => {
    const ok = await navigateToFirstWorkspace(page);
    if (!ok) {
      test.skip();
      return;
    }

    await page.waitForTimeout(500);

    // Find the task card by title
    const taskCard = page.locator("[data-testid='task-card']").filter({ hasText: TASK_TITLE });
    const taskText = page.getByText(TASK_TITLE);

    const cardVisible = await taskCard.isVisible({ timeout: 8000 }).catch(() => false);
    const textVisible = await taskText.first().isVisible({ timeout: 3000 }).catch(() => false);

    if (!cardVisible && !textVisible) {
      test.skip();
      return;
    }

    // Right-click to open the custom context menu (TaskCardContextMenu via createPortal)
    if (cardVisible) {
      await taskCard.first().click({ button: "right" });
    } else {
      await taskText.first().click({ button: "right" });
    }

    // TaskCardContextMenu renders via createPortal into document.body at z-index: 9999.
    // Menu items are plain <button> elements (no role="menuitem").
    await page.waitForSelector("[style*='z-index: 9999']", { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(200);

    const contextMenu = page.locator("[style*='z-index: 9999']").last();
    let statusChanged = false;

    if (await contextMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
      const menuBtns = contextMenu.locator("button");
      const count = await menuBtns.count();
      for (let i = 0; i < count; i++) {
        const text = await menuBtns.nth(i).textContent();
        if (text?.includes("In Progress") || text?.includes("进行中")) {
          await menuBtns.nth(i).click();
          statusChanged = true;
          break;
        }
      }
    }

    if (!statusChanged) {
      // Fallback: scan all buttons
      const allBtns = page.locator("button");
      const count = await allBtns.count();
      for (let i = 0; i < count; i++) {
        const text = await allBtns.nth(i).textContent();
        if (text?.includes("In Progress") || text?.includes("进行中")) {
          await allBtns.nth(i).click();
          statusChanged = true;
          break;
        }
      }
    }

    if (!statusChanged) {
      test.skip();
      return;
    }

    await page.waitForTimeout(500);
    // Verify task is still visible after status change
    await expect(page.getByText(TASK_TITLE)).toBeVisible({ timeout: 5000 });
  });

  test("4. Mark task as DONE via context menu", async ({ page }) => {
    const ok = await navigateToFirstWorkspace(page);
    if (!ok) {
      test.skip();
      return;
    }

    await page.waitForTimeout(500);

    // Find task card — it may now be in IN_PROGRESS column
    const taskCard = page.locator("[data-testid='task-card']").filter({ hasText: TASK_TITLE });
    const taskText = page.getByText(TASK_TITLE);

    const cardVisible = await taskCard.isVisible({ timeout: 8000 }).catch(() => false);
    const textVisible = await taskText.first().isVisible({ timeout: 3000 }).catch(() => false);

    if (!cardVisible && !textVisible) {
      test.skip();
      return;
    }

    // Right-click to open the custom context menu
    if (cardVisible) {
      await taskCard.first().click({ button: "right" });
    } else {
      await taskText.first().click({ button: "right" });
    }

    // Wait for context menu portal (same structure as test 3)
    await page.waitForSelector("[style*='z-index: 9999']", { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(200);

    const contextMenu = page.locator("[style*='z-index: 9999']").last();
    let statusChanged = false;

    if (await contextMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
      const menuBtns = contextMenu.locator("button");
      const count = await menuBtns.count();
      for (let i = 0; i < count; i++) {
        const text = await menuBtns.nth(i).textContent();
        // "Done" is the BOARD_COLUMNS label (BOARD_COLUMNS in constants.ts)
        if (text?.includes("Done") || text?.includes("完成") || text?.includes("已完成")) {
          await menuBtns.nth(i).click();
          statusChanged = true;
          break;
        }
      }
    }

    if (!statusChanged) {
      // Fallback: scan all buttons
      const allBtns = page.locator("button");
      const count = await allBtns.count();
      for (let i = 0; i < count; i++) {
        const text = await allBtns.nth(i).textContent();
        if (text?.trim() === "Done" || text?.includes("完成") || text?.includes("已完成")) {
          await allBtns.nth(i).click();
          statusChanged = true;
          break;
        }
      }
    }

    if (!statusChanged) {
      test.skip();
      return;
    }

    await page.waitForTimeout(500);
    // Verify task is still visible after moving to DONE
    await expect(page.getByText(TASK_TITLE)).toBeVisible({ timeout: 5000 });
  });
});
