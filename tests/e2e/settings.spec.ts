import { test, expect } from "@playwright/test";

test.describe("Phase 1: Theme + General Settings", () => {
  test("1.1 Settings defaults to General section with correct nav items", async ({
    page,
  }) => {
    await page.goto("/settings");
    const nav = page.locator("nav");
    await expect(nav.getByText("General")).toBeVisible();
    await expect(nav.getByText("AI Tools")).toBeVisible();
    await expect(nav.getByText("Prompts")).toBeVisible();
    // General section should be active (has accent bg)
    const generalBtn = nav.locator("button").filter({ hasText: "General" });
    await expect(generalBtn).toHaveClass(/bg-accent/);
  });

  test("1.2 Theme segmented control renders with Light/Dark/System options", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForTimeout(500);
    const themeButtons = page
      .locator("button")
      .filter({ hasText: /^(Light|Dark|System|浅色|深色|跟随系统)$/ });
    await expect(themeButtons.first()).toBeVisible();
    const count = await themeButtons.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("1.3 Clicking Dark theme switches UI to dark mode", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForTimeout(500);
    const darkBtn = page
      .locator("button")
      .filter({ hasText: /^(Dark|深色)$/ });
    await darkBtn.click();
    await page.waitForTimeout(300);
    const htmlClass = await page.locator("html").getAttribute("class");
    expect(htmlClass).toContain("dark");
  });

  test("1.4 Clicking Light theme switches UI to light mode", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForTimeout(500);
    const darkBtn = page
      .locator("button")
      .filter({ hasText: /^(Dark|深色)$/ });
    await darkBtn.click();
    await page.waitForTimeout(300);
    const lightBtn = page
      .locator("button")
      .filter({ hasText: /^(Light|浅色)$/ });
    await lightBtn.click();
    await page.waitForTimeout(300);
    const htmlClass = await page.locator("html").getAttribute("class");
    expect(htmlClass).not.toContain("dark");
  });

  test("1.5 Theme persists after page reload", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForTimeout(500);
    const darkBtn = page
      .locator("button")
      .filter({ hasText: /^(Dark|深色)$/ });
    await darkBtn.click();
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForTimeout(500);
    const htmlClass = await page.locator("html").getAttribute("class");
    expect(htmlClass).toContain("dark");
  });

  test("1.6 Language toggle switches between Chinese and English", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForTimeout(500);
    // Click English button
    const enBtn = page.locator("button").filter({ hasText: "English" });
    await enBtn.click();
    await page.waitForTimeout(300);
    // Use heading role to avoid strict mode violation
    await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
    // Switch to Chinese
    const zhBtn = page.locator("button").filter({ hasText: "中文" });
    await zhBtn.click();
    await page.waitForTimeout(300);
    await expect(page.getByRole("heading", { name: "主题" })).toBeVisible();
  });
});

test.describe("Phase 2: CLI Adapter Verification", () => {
  test("2.1 AI Tools shows adapter card with test button and default badge", async ({
    page,
  }) => {
    await page.goto("/settings");
    const nav = page.locator("nav");
    await nav.getByText("AI Tools").click();
    await page.waitForTimeout(500);
    // Claude Code adapter should be visible
    await expect(page.getByText("Claude Code")).toBeVisible();
    // Test Connection button should be visible
    const testBtn = page
      .locator("button")
      .filter({ hasText: /测试连接|Test Connection/ });
    await expect(testBtn).toBeVisible();
    // Default badge should be visible (Claude Code is default)
    await expect(page.locator("text=/默认|Default/i")).toBeVisible();
  });

  test("2.2 Test Connection button works and shows results", async ({
    page,
  }) => {
    test.setTimeout(60000); // CLI test can take a while
    await page.goto("/settings");
    const nav = page.locator("nav");
    await nav.getByText("AI Tools").click();
    await page.waitForTimeout(500);
    // Click test connection
    const testBtn = page
      .locator("button")
      .filter({ hasText: /测试连接|Test Connection/ });
    await testBtn.click();
    // Wait for results — look for pass/fail icons (CheckCircle2 or XCircle)
    await expect(
      page.locator("text=/检测通过|部分检测未通过|All checks passed|Some checks failed/")
    ).toBeVisible({ timeout: 50000 });
  });

  test("2.3 Button disabled during test (no double-trigger)", async ({
    page,
  }) => {
    await page.goto("/settings");
    const nav = page.locator("nav");
    await nav.getByText("AI Tools").click();
    await page.waitForTimeout(500);
    const testBtn = page
      .locator("button")
      .filter({ hasText: /测试连接|Test Connection/ });
    await testBtn.click();
    const loadingBtn = page
      .locator("button")
      .filter({ hasText: /测试中|Testing/ });
    await expect(loadingBtn).toBeDisabled({ timeout: 2000 });
  });
});

test.describe.serial("Phase 3: Agent Prompt Management", () => {
  test("3.1 Prompts section shows create button", async ({ page }) => {
    await page.goto("/settings");
    const nav = page.locator("nav");
    await nav.getByText("Prompts").click();
    await page.waitForTimeout(500);
    await expect(page.locator("h2")).toBeVisible();
    // Use specific button text for prompts
    await expect(
      page.getByRole("button", { name: /新建提示词|New Prompt/ })
    ).toBeVisible();
  });

  test("3.2 Create new prompt via dialog", async ({ page }) => {
    await page.goto("/settings");
    const nav = page.locator("nav");
    await nav.getByText("Prompts").click();
    await page.waitForTimeout(500);
    // Click create button using specific text
    await page.getByRole("button", { name: /新建提示词|New Prompt/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });
    // Fill form
    await dialog.locator("#prompt-name").fill("E2E Test Prompt");
    await dialog.locator("#prompt-description").fill("Test description");
    await dialog
      .locator("#prompt-content")
      .fill("You are a helpful assistant.");
    // Click save
    const saveBtn = dialog
      .locator("button")
      .filter({ hasText: /保存|Save/ });
    await saveBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText("E2E Test Prompt")).toBeVisible({
      timeout: 5000,
    });
  });

  test("3.3 Edit existing prompt", async ({ page }) => {
    await page.goto("/settings");
    const nav = page.locator("nav");
    await nav.getByText("Prompts").click();
    await page.waitForTimeout(1000);
    // Find the prompt card and its edit button (Edit icon)
    const promptText = page.getByText("E2E Test Prompt");
    await expect(promptText).toBeVisible({ timeout: 5000 });
    // The card structure: CardContent > div(flex) > div(text) + div(buttons)
    // Edit button has Edit (pencil) icon - it's the second action button
    const card = promptText.locator("xpath=ancestor::div[contains(@class, 'p-4')]");
    const buttons = card.locator("button");
    // Buttons order: Star, Edit, Delete
    await buttons.nth(1).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });
    const nameInput = dialog.locator("#prompt-name");
    await expect(nameInput).toHaveValue("E2E Test Prompt");
    await nameInput.clear();
    await nameInput.fill("E2E Updated Prompt");
    const saveBtn = dialog
      .locator("button")
      .filter({ hasText: /保存|Save/ });
    await saveBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText("E2E Updated Prompt")).toBeVisible({
      timeout: 5000,
    });
  });

  test("3.4 Set prompt as default", async ({ page }) => {
    await page.goto("/settings");
    const nav = page.locator("nav");
    await nav.getByText("Prompts").click();
    await page.waitForTimeout(1000);
    const promptText = page.getByText("E2E Updated Prompt");
    await expect(promptText).toBeVisible({ timeout: 5000 });
    const card = promptText.locator("xpath=ancestor::div[contains(@class, 'p-4')]");
    const buttons = card.locator("button");
    // Star button is first
    await buttons.first().click();
    await page.waitForTimeout(1000);
    // Default badge should appear
    await expect(
      card.locator("text=/默认|Default/i")
    ).toBeVisible({ timeout: 5000 });
  });

  test("3.5 Delete prompt with confirmation", async ({ page }) => {
    await page.goto("/settings");
    const nav = page.locator("nav");
    await nav.getByText("Prompts").click();
    await page.waitForTimeout(1000);
    const promptText = page.getByText("E2E Updated Prompt");
    await expect(promptText).toBeVisible({ timeout: 5000 });
    const card = promptText.locator("xpath=ancestor::div[contains(@class, 'p-4')]");
    const buttons = card.locator("button");
    // Delete button is last
    await buttons.last().click();
    // Confirmation dialog
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });
    // Click the destructive delete button in the dialog
    const deleteBtn = dialog.locator("button").filter({ hasText: /删除|Delete/ });
    await deleteBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText("E2E Updated Prompt")).not.toBeVisible({
      timeout: 5000,
    });
  });
});
