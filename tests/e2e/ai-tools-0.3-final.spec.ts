import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const projectRoot = path.resolve(__dirname, "../..");
const keyOriginal = "UI_CANARY_KEY_4f18_original";
const keyEdited = "UI_CANARY_KEY_4f18_edited";
const longConnectionName = `Browser Fake API ${"long-name-".repeat(10)}`;

let temporaryRoot = "";
let dataRoot = "";
let databasePath = "";
let tower: ChildProcess | null = null;
let upstream: Server | null = null;
let appOrigin = "";
let upstreamBaseUrl = "";
let screenshotDir = "";
let fixturePluginDir = "";
let fixtureCliPath = "";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => typeof address === "object" && address
        ? resolve(address.port)
        : reject(new Error("temporary port allocation failed")));
    });
  });
}

async function waitForApp(origin: string, processHandle: ChildProcess): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) throw new Error(`Tower exited early with ${processHandle.exitCode}`);
    try {
      const response = await fetch(`${origin}/settings`);
      if (response.status > 0) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Tower UI did not become ready");
}

async function stopProcess(processHandle: ChildProcess | null): Promise<void> {
  if (!processHandle || processHandle.exitCode !== null || !processHandle.pid) return;
  try {
    process.kill(-processHandle.pid, "SIGTERM");
  } catch {}
  await Promise.race([
    new Promise((resolve) => processHandle.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (processHandle.exitCode === null) {
    try { process.kill(-processHandle.pid, "SIGKILL"); } catch {}
  }
}

async function startFakeUpstream(): Promise<string> {
  upstream = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (request.method === "GET" && request.url?.includes("models")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "fixture-model" }, { id: "discovered-model" }] }));
        return;
      }
      if (body.includes("browser-error")) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "controlled fake upstream failure" } }));
        return;
      }
      let parsedBody: { stream?: boolean } = {};
      try { parsedBody = JSON.parse(body) as { stream?: boolean }; } catch {}
      if (parsedBody.stream !== true) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "ui-smoke", object: "chat.completion", created: 1, model: "fixture-model",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        }));
        return;
      }
      const send = () => {
        if (response.destroyed) return;
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.write(`data: ${JSON.stringify({
          id: "ui-smoke", object: "chat.completion.chunk", created: 1, model: "fixture-model",
          choices: [{ index: 0, delta: { role: "assistant", content: "browser-assistant-ok" }, finish_reason: null }],
        })}\n\n`);
        response.write(`data: ${JSON.stringify({
          id: "ui-smoke", object: "chat.completion.chunk", created: 1, model: "fixture-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`);
        response.end("data: [DONE]\n\n");
      };
      if (body.includes("browser-cancel")) setTimeout(send, 15_000).unref();
      else send();
    });
  });
  await new Promise<void>((resolve, reject) => {
    upstream!.once("error", reject);
    upstream!.listen(0, "127.0.0.1", resolve);
  });
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("fake upstream bind failed");
  return `http://127.0.0.1:${address.port}/v1`;
}

async function seedUiDatabase(): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
  try {
    await prisma.systemConfig.upsert({
      where: { key: "onboarding.completed" },
      create: { key: "onboarding.completed", value: "true" },
      update: { value: "true" },
    });
    await prisma.systemConfig.upsert({
      where: { key: "onboarding.tourCompleted" },
      create: { key: "onboarding.tourCompleted", value: "true" },
      update: { value: "true" },
    });
    const workspace = await prisma.workspace.findFirstOrThrow();
    const projectDir = path.join(temporaryRoot, "fixture-project");
    await fs.mkdir(projectDir, { recursive: true });
    const project = await prisma.project.create({
      data: { id: "ui-project", name: "Browser Fixture Project", workspaceId: workspace.id, localPath: projectDir },
    });
    await prisma.providerConnection.upsert({
      where: { id: "ui-api" },
      create: {
        id: "ui-api", name: longConnectionName, kind: "api", provider: "openai-compatible",
        enabled: true, testStatus: "connected", testOk: true, baseUrl: upstreamBaseUrl,
        defaultModelId: "fixture-model",
        headersJson: JSON.stringify([{ id: "seed-header", name: "X-Fixture", value: "seed", enabled: true, sensitive: false }]),
        queryParamsJson: JSON.stringify([{ id: "seed-query", name: "region", value: "local", enabled: true, sensitive: false }]),
        apiKeys: { create: { id: "ui-key", label: "primary-browser-key", value: keyOriginal, enabled: true, order: 0, testStatus: "ok" } },
        models: { create: [
          { id: "ui-model", modelId: "fixture-model", source: "manual", available: true },
          { id: "ui-fallback-model", modelId: "fallback-model", source: "manual", available: false },
        ] },
      },
      update: { name: longConnectionName, baseUrl: upstreamBaseUrl, enabled: true, testStatus: "connected", testOk: true },
    });
    for (const slot of ["summary", "dreaming", "analysis", "assistant"] as const) {
      const config = await prisma.aiCapabilityConfig.upsert({
        where: { slot }, create: { slot, migrationStatus: "complete" }, update: { migrationStatus: "complete" },
      });
      await prisma.aiCapabilityTarget.deleteMany({ where: { capabilityConfigId: config.id } });
      await prisma.aiCapabilityTarget.createMany({ data: [
        { id: `ui-${slot}-primary`, capabilityConfigId: config.id, connectionId: "ui-api", modelId: "fixture-model", targetKey: "ui-api:fixture-model", order: 0 },
        { id: `ui-${slot}-fallback`, capabilityConfigId: config.id, connectionId: "ui-api", modelId: "fallback-model", targetKey: "ui-api:fallback-model", order: 1 },
      ] });
    }
    await prisma.aiCapabilityAttempt.create({
      data: {
        id: "ui-diagnostic", requestId: "ui-diagnostic-request", slot: "analysis",
        targetId: "ui-analysis-fallback", connectionId: "ui-api", connectionRefId: "ui-api",
        modelId: "fallback-model", startedAt: new Date(), durationMs: 7, result: "failed", errorCode: "model_unavailable",
      },
    });
    await prisma.assistantSession.create({
      data: {
        id: "as_00000000-0000-4000-8000-000000000001", title: "Imported Legacy Browser Session", workspaceId: workspace.id,
        workspaceNameSnapshot: workspace.name, projectId: project.id, projectNameSnapshot: project.name,
        legacySource: "claude-agent-sdk", legacyId: "00000000-0000-4000-8000-000000000002",
        messages: { create: [
          { id: "ui-message-user", sequence: 0, role: "USER", partsJson: JSON.stringify([{ type: "text", text: "seeded browser user" }]) },
          { id: "ui-message-assistant", sequence: 1, role: "ASSISTANT", partsJson: JSON.stringify([
            { type: "text", text: "seeded browser assistant" },
            { type: "tool-call", toolCallId: "browser-tool", toolName: "create_task", input: { title: "Fixture" } },
            { type: "tool-result", toolCallId: "browser-tool", toolName: "create_task", output: { id: "fixture-task" } },
          ]) },
        ] },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function openAiTools(page: Page): Promise<void> {
  await page.goto(`${appOrigin}/settings`);
  await page.evaluate(() => localStorage.setItem("locale", "en"));
  await page.reload();
  await page.getByRole("button", { name: "AI Tools", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  await expect(page.getByText(longConnectionName, { exact: true })).toBeVisible();
}

test.describe.serial("AI Tools 0.3 final browser acceptance", () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-ai-tools-ui-"));
    dataRoot = path.join(temporaryRoot, "tower-data");
    databasePath = path.join(dataRoot, "database", "tower.db");
    screenshotDir = path.join(temporaryRoot, "screenshots");
    const home = path.join(temporaryRoot, "home");
    const fakeBin = path.join(temporaryRoot, "fake-bin");
    fixturePluginDir = path.join(temporaryRoot, "fixture-provider");
    await Promise.all([dataRoot, home, fakeBin, screenshotDir].map((directory) => fs.mkdir(directory, { recursive: true })));
    await fs.cp(path.join(projectRoot, "packages", "ai-runtime", "test", "fixtures", "valid-plugin"), fixturePluginDir, { recursive: true });
    for (const command of ["claude", "codex", "gemini", "fixture-cli"]) {
      const executable = path.join(fakeBin, command);
      await fs.writeFile(executable, `#!/bin/sh\nprintf '${command} fake 0.3.0\\n'\n`, { mode: 0o700 });
      if (command === "fixture-cli") fixtureCliPath = executable;
    }
    upstreamBaseUrl = await startFakeUpstream();
    const port = await freePort();
    appOrigin = `http://127.0.0.1:${port}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      TOWER_DATA_DIR: dataRoot,
      DATABASE_URL: `file:${databasePath}`,
      PATH: `${fakeBin}${path.delimiter}/usr/local/bin:/usr/bin:/bin`,
      TOWER_NO_OPEN: "1",
    };
    for (const key of ["TOWER_TASK_ID", "TOWER_TASK_TITLE", "CALLBACK_URL", "__NEXT_PRIVATE_ORIGIN", "__NEXT_PRIVATE_STANDALONE_CONFIG"]) {
      delete env[key];
    }
    const log = await fs.open(path.join(temporaryRoot, "tower.log"), "a");
    tower = spawn(process.execPath, [path.join(projectRoot, "bin", "tower.mjs"), "--port", String(port), "--no-open"], {
      cwd: projectRoot, detached: true, stdio: ["ignore", log.fd, log.fd], env,
    });
    tower.unref();
    await log.close();
    await waitForApp(appOrigin, tower);
    await seedUiDatabase();
  });

  test.afterAll(async () => {
    await stopProcess(tower);
    if (upstream) await new Promise<void>((resolve) => upstream!.close(() => resolve()));
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  test("settings Key, models, parameters, slots, persistence, accessibility, and i18n", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    await openAiTools(page);

    const connectionsTop = await page.getByRole("heading", { name: "Connections", exact: true }).boundingBox();
    const slotsTop = await page.getByRole("heading", { name: "Capability Slots", exact: true }).boundingBox();
    expect(connectionsTop && slotsTop && connectionsTop.y < slotsTop.y).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.getByRole("button", { name: "New Connection" }).click();
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel("Connection name").fill("Ephemeral Browser API");
    await createDialog.getByLabel("Full Base URL").fill(upstreamBaseUrl);
    await createDialog.getByLabel("Default model").fill("fixture-model");
    await createDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Connection saved")).toBeVisible();
    await createDialog.getByRole("button", { name: "Delete", exact: true }).click();
    const deleteConnectionDialog = page.getByRole("dialog").filter({ hasText: "Delete API connection" });
    await deleteConnectionDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Ephemeral Browser API", { exact: true })).toHaveCount(0);

    const connectionRow = page.locator("li")
      .filter({ has: page.getByText(longConnectionName, { exact: true }) })
      .filter({ has: page.getByRole("button", { name: "Edit", exact: true }) })
      .first();
    await connectionRow.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Keys" }).click();
    await expect(dialog.getByLabel("Masked Key")).toHaveText("••••••••••••");
    await expect(dialog).not.toContainText(keyOriginal);
    await dialog.getByRole("button", { name: "Show full value" }).click();
    await expect(dialog.getByLabel("Masked Key")).toHaveValue(keyOriginal);
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(keyOriginal);
    await dialog.getByRole("button", { name: "Edit", exact: true }).click();
    const keyInput = dialog.getByLabel("Full Key");
    await keyInput.fill(keyEdited);
    await keyInput.press("Tab");
    await keyInput.locator("xpath=ancestor::li").getByRole("button", { name: "Save", exact: true }).click();
    await dialog.getByRole("button", { name: "Test this Key" }).click();
    await expect(page.getByText("All checks passed")).toBeVisible();

    await dialog.getByRole("button", { name: "Add Key" }).click();
    await dialog.getByLabel("Key label").fill("secondary-browser-key");
    const newKeyInput = dialog.getByLabel("Full Key");
    await newKeyInput.fill("UI_SECONDARY_FAKE_KEY");
    await newKeyInput.locator("xpath=ancestor::div[contains(@class, 'grid')]").getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByText("secondary-browser-key", { exact: true })).toBeVisible();

    await dialog.getByRole("tab", { name: "Models" }).click();
    await dialog.getByRole("button", { name: "Refresh upstream" }).click();
    await expect(dialog.getByText("discovered-model", { exact: true })).toBeVisible();
    await dialog.getByLabel("Enter a manual model ID").fill("browser-manual-model");
    await dialog.getByRole("button", { name: "Add model" }).click();
    await expect(dialog.getByText("browser-manual-model", { exact: true })).toBeVisible();

    await dialog.getByRole("tab", { name: "Connection" }).click();
    const addParameters = dialog.getByRole("button", { name: "Add Parameter" });
    await addParameters.first().click();
    const headerNames = dialog.getByLabel("Parameter name");
    await headerNames.last().fill("X-Browser-Header");
    const headerValues = dialog.getByLabel("Parameter value");
    await headerValues.last().fill("browser-header-value");
    await addParameters.last().click();
    await dialog.getByLabel("Parameter name").last().fill("browser-query");
    await dialog.getByLabel("Parameter value").last().fill("browser-query-value");
    await dialog.getByRole("button", { name: "Save", exact: true }).last().click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

    const analysisCard = page.getByRole("heading", { name: "Project Analysis" }).locator("xpath=ancestor::article");
    await expect(analysisCard.getByText("model_unavailable", { exact: true })).toBeVisible();
    const assistantCard = page.getByRole("heading", { name: "AI Assistant" }).locator("xpath=ancestor::article");
    await assistantCard.getByRole("button", { name: "Move target down" }).first().click();
    await page.reload();
    await page.getByRole("button", { name: "AI Tools", exact: true }).click();
    await expect(page.getByText("secondary-browser-key", { exact: true })).toHaveCount(0);
    await page.locator("li")
      .filter({ has: page.getByText(longConnectionName, { exact: true }) })
      .filter({ has: page.getByRole("button", { name: "Edit", exact: true }) })
      .first()
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await page.getByRole("dialog").getByRole("tab", { name: "Keys" }).click();
    await expect(page.getByRole("dialog").getByText("secondary-browser-key", { exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Show full value" }).first().click();
    await expect(page.getByRole("dialog").getByLabel("Masked Key").first()).toHaveValue(keyEdited);
    await page.getByRole("dialog").getByRole("button", { name: "Test all" }).click();
    await expect(page.getByText("All checks passed")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();

    await page.getByRole("button", { name: "Add CLI plugin" }).click();
    const installDialog = page.getByRole("dialog");
    await installDialog.getByRole("tab", { name: "Local directory" }).click();
    await installDialog.getByLabel("Plugin directory").fill(fixturePluginDir);
    await installDialog.getByRole("button", { name: "Review install plan" }).click();
    await expect(installDialog.getByText("process:spawn", { exact: false })).toBeVisible();
    await installDialog.getByRole("button", { name: "Install disabled" }).click();
    await installDialog.getByRole("button", { name: "Confirm permissions and enable" }).click();
    const pluginRow = page.locator("li")
      .filter({ hasText: "@fixture/tower-cli" })
      .filter({ has: page.getByRole("button", { name: "Edit", exact: true }) })
      .first();
    await expect(pluginRow.getByText("Fixture CLI", { exact: true })).toBeVisible();
    await pluginRow.getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByText("Hello test passed")).toBeVisible();
    await pluginRow.getByRole("button", { name: "Edit", exact: true }).click();
    const pluginDialog = page.getByRole("dialog");
    await pluginDialog.getByLabel("Connection name").fill("Configured Browser Fixture");
    await pluginDialog.getByLabel("Command override (absolute path allowed)").fill(fixtureCliPath);
    await pluginDialog.getByLabel("profile").fill("browser-profile");
    await pluginDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Plugin connection saved")).toBeVisible();
    await pluginDialog.press("Escape");
    await pluginRow.getByRole("button", { name: "Disable", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(pluginRow.getByRole("button", { name: "Enable", exact: true })).toBeVisible();
    await pluginRow.getByRole("button", { name: "Enable", exact: true }).click();
    await expect(pluginRow.getByRole("button", { name: "Disable", exact: true })).toBeVisible();
    await pluginRow.getByRole("button", { name: "Uninstall", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(pluginRow).toHaveCount(0);
    const preservedPluginConnection = page.locator("li").filter({ hasText: "@fixture/tower-cli" }).first();
    await expect(preservedPluginConnection.getByText("Plugin uninstalled", { exact: true })).toBeVisible();

    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
    const unnamedButtons = await page.locator("button:visible").evaluateAll((buttons) => buttons.filter((button) => {
      const element = button as HTMLElement;
      return !(element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent?.trim());
    }).length);
    expect(unnamedButtons).toBe(0);
    await page.evaluate(() => localStorage.setItem("locale", "zh"));
    await page.reload();
    await page.getByRole("button", { name: "AI 工具", exact: true }).click();
    await expect(page.getByRole("heading", { name: "连接", exact: true })).toBeVisible();
    expect((await page.locator("body").innerText()).includes("settings." )).toBe(false);
    await context.close();
  });

  test("Assistant sessions, binding, text, tool card, attachment, cancel, and error", async ({ browser }) => {
    const directResponse = await fetch(`${appOrigin}/api/internal/assistant/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "browser direct assistant", clientTurnId: "browser_direct_12345678" }),
    });
    const directBody = await directResponse.text();
    expect(directResponse.status, directBody).toBe(200);
    expect(directBody).toContain("browser-assistant-ok");
    expect(directBody).toContain('"type":"done"');

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto(`${appOrigin}/settings`);
    await page.evaluate(() => localStorage.setItem("locale", "en"));
    await page.reload();
    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    await page.getByRole("button", { name: "Sessions" }).click();
    await page.getByRole("menuitem").filter({ hasText: "Imported Legacy Browser Session" }).click();
    await expect(page.getByText("seeded browser assistant", { exact: true })).toBeVisible();
    await expect(page.getByText("create_task", { exact: true })).toBeVisible();
    const workspaceBinding = page.getByRole("combobox", { name: "Assistant workspace" });
    const projectBinding = page.getByRole("combobox", { name: "Assistant project" });
    const versionBinding = page.getByRole("combobox", { name: "Assistant version" });
    await expect(workspaceBinding).toContainText("My Workspace");
    await expect(projectBinding).toContainText("Browser Fixture Project");
    await expect(versionBinding).toContainText("All versions");
    await workspaceBinding.click();
    await page.getByRole("option", { name: "All workspaces" }).click();
    await expect(projectBinding).toBeDisabled();
    await workspaceBinding.click();
    await page.getByRole("option", { name: "My Workspace" }).click();
    await expect(projectBinding).toBeEnabled();
    await projectBinding.click();
    await page.getByRole("option", { name: "Browser Fixture Project" }).click();
    await expect(projectBinding).toContainText("Browser Fixture Project");

    await page.getByRole("button", { name: "New Session" }).click();
    await expect(workspaceBinding).toContainText("All workspaces");
    await expect(projectBinding).toBeDisabled();
    await expect(versionBinding).toBeDisabled();
    const input = page.locator("[data-assistant-input]");
    await input.fill("browser assistant stream");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("browser-assistant-ok", { exact: true })).toBeVisible();

    const attachment = path.join(temporaryRoot, "browser-attachment.txt");
    await fs.writeFile(attachment, "browser attachment body");
    await page.locator("input[type=file]").setInputFiles(attachment);
    await expect(page.getByText("browser-attachment.txt", { exact: true })).toBeVisible();
    await input.fill("browser attachment turn");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("browser-assistant-ok", { exact: true })).toHaveCount(2);

    await input.fill("browser-cancel");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
    await input.fill("browser-error");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(/Error:|Connection error:/)).toBeVisible();

    await page.getByRole("button", { name: "Sessions" }).click();
    await page.getByRole("button", { name: "Rename" }).first().click();
    const renameDialog = page.getByRole("dialog");
    await renameDialog.getByPlaceholder("Enter session name").fill("Renamed Browser Session");
    await renameDialog.getByRole("button", { name: "Save" }).click();
    const sessionTrigger = page.getByRole("button", { name: "Sessions" });
    await expect(sessionTrigger).toContainText("Renamed Browser Session");
    await sessionTrigger.click();
    const renamedSession = page.getByRole("menuitem").filter({ hasText: "Renamed Browser Session" });
    await renamedSession.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Renamed Browser Session", { exact: true })).toHaveCount(0);
    await context.close();
  });

  test("final three viewport screenshots and layout assertions", async ({ browser }) => {
    const viewports = [
      { name: "desktop", width: 1440, height: 900, assistant: false },
      { name: "laptop", width: 1280, height: 720, assistant: false },
      { name: "mobile", width: 390, height: 844, assistant: true },
    ];
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      await page.goto(`${appOrigin}/settings`);
      await page.evaluate(() => localStorage.setItem("locale", "en"));
      await page.reload();
      if (viewport.assistant) {
        await page.getByRole("button", { name: "Assistant", exact: true }).click();
        await expect(page.getByText("Tower Assistant", { exact: true })).toBeVisible();
      } else {
        await page.getByRole("button", { name: "AI Tools", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: path.join(screenshotDir, `${viewport.name}.png`), fullPage: false });
      await context.close();
    }
    expect((await fs.readdir(screenshotDir)).sort()).toEqual(["desktop.png", "laptop.png", "mobile.png"]);
  });
});
