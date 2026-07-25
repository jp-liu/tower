import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { ApiConnectionsSection } from "../api-connections-section";

const secret = "fixture-key-never-log";
const backupSecret = "fixture-backup-never-log";
const connection = {
  id: "api-1",
  connectionKey: null,
  name: "Local gateway with a very long connection name",
  kind: "api",
  provider: "openai-compatible",
  enabled: true,
  testStatus: "partial",
  testOk: true,
  presetId: null,
  baseUrl: "http://127.0.0.1:11434/custom/path",
  defaultModelId: "manual/large-model-id",
  headersJson: "[]",
  queryParamsJson: "[]",
  headers: [{ id: "header-1", name: "Authorization", value: secret, enabled: true, sensitive: true }],
  queryParams: [],
  apiKeys: [
    {
      id: "key-1", connectionId: "api-1", label: "Primary", value: secret,
      enabled: true, order: 0, testStatus: "ok", lastTestedAt: null, lastError: null,
      createdAt: new Date(), updatedAt: new Date(),
    },
    {
      id: "key-2", connectionId: "api-1", label: "Backup", value: backupSecret,
      enabled: true, order: 1, testStatus: "untested", lastTestedAt: null, lastError: null,
      createdAt: new Date(), updatedAt: new Date(),
    },
  ],
  models: [{
    id: "model-1", connectionId: "api-1", modelId: "manual/large-model-id",
    source: "manual", available: true, lastDiscoveredAt: null,
    capabilitiesJson: null, metadataJson: null, createdAt: new Date(), updatedAt: new Date(),
  }],
  createdAt: new Date(), updatedAt: new Date(), lastTestedAt: null,
};

const actionMocks = vi.hoisted(() => ({
  listApiConnections: vi.fn(), listApiConnectionPresets: vi.fn(),
  createApiConnection: vi.fn(), updateApiConnection: vi.fn(), deleteApiConnection: vi.fn(),
  setApiConnectionEnabled: vi.fn(), addApiKey: vi.fn(), updateApiKey: vi.fn(),
  deleteApiKey: vi.fn(), reorderApiKeys: vi.fn(), testApiKey: vi.fn(),
  testApiConnection: vi.fn(), addManualApiModel: vi.fn(), removeManualApiModel: vi.fn(),
  refreshApiModels: vi.fn(),
}));

vi.mock("@/actions/api-connection-actions", () => ({
  listApiConnections: actionMocks.listApiConnections,
  listApiConnectionPresets: actionMocks.listApiConnectionPresets,
  createApiConnection: actionMocks.createApiConnection,
  updateApiConnection: actionMocks.updateApiConnection,
  deleteApiConnection: actionMocks.deleteApiConnection,
  setApiConnectionEnabled: actionMocks.setApiConnectionEnabled,
  addApiKey: actionMocks.addApiKey,
  updateApiKey: actionMocks.updateApiKey,
  deleteApiKey: actionMocks.deleteApiKey,
  reorderApiKeys: actionMocks.reorderApiKeys,
  testApiKey: actionMocks.testApiKey,
  testApiConnection: actionMocks.testApiConnection,
  addManualApiModel: actionMocks.addManualApiModel,
  removeManualApiModel: actionMocks.removeManualApiModel,
  refreshApiModels: actionMocks.refreshApiModels,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderSection() {
  return render(<I18nProvider><ApiConnectionsSection /></I18nProvider>);
}

function activePanel() {
  const panel = document.querySelector<HTMLElement>('[role="tabpanel"]:not([inert])');
  expect(panel).not.toBeNull();
  return panel!;
}

describe("ApiConnectionsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.listApiConnections.mockResolvedValue({ ok: true, data: [connection] });
    actionMocks.listApiConnectionPresets.mockResolvedValue({
      source: "fixture", generatedAt: "2026-01-01",
      presets: [{ id: "preset-openai", name: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com/v1", docsUrl: "https://example.test", logoId: "openai" }],
    });
    for (const name of [
      "createApiConnection", "updateApiConnection", "setApiConnectionEnabled", "addApiKey",
      "updateApiKey", "deleteApiKey", "reorderApiKeys", "addManualApiModel",
    ]) actionMocks[name as keyof typeof actionMocks].mockResolvedValue({ ok: true, data: connection });
    actionMocks.deleteApiConnection.mockResolvedValue({ ok: true, data: undefined });
    actionMocks.testApiKey.mockResolvedValue({ ok: true, data: { ok: true } });
    actionMocks.testApiConnection.mockResolvedValue({ ok: true, data: [{ keyId: "key-1", ok: true }] });
    actionMocks.refreshApiModels.mockResolvedValue({ ok: true, data: { ok: true, models: [] } });
    actionMocks.removeManualApiModel.mockResolvedValue({ ok: false, error: { code: "model_in_use", message: "safe" } });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("creates a custom connection without rewriting its full Base URL", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: /新建连接|New Connection/ }));
    await user.type(screen.getByLabelText(/连接名称|Connection name/), "Office API");
    await user.type(screen.getByLabelText(/完整 Base URL|Full Base URL/), "http://localhost:9000/custom");
    await user.type(screen.getByLabelText(/默认模型|Default model/), "model-x");
    await user.click(screen.getByRole("button", { name: /^保存$|^Save$/ }));
    await waitFor(() => expect(actionMocks.createApiConnection).toHaveBeenCalledWith(expect.objectContaining({
      name: "Office API", protocol: "openai-compatible", baseUrl: "http://localhost:9000/custom",
    })));
  });

  it("offers local presets and editable advanced headers", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: /新建连接|New Connection/ }));
    await user.click(screen.getByLabelText(/本地预设|Local preset/));
    expect(await screen.findByText("OpenAI")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    const addButtons = screen.getAllByRole("button", { name: /新增参数|Add parameter/ });
    await user.click(addButtons[0]);
    expect(screen.getByLabelText(/参数名|Parameter name/)).toBeInTheDocument();
  });

  it("keeps Key material out of the default DOM and supports explicit reveal and copy", async () => {
    const user = userEvent.setup();
    const clipboardSpy = vi.spyOn(navigator.clipboard, "writeText");
    renderSection();
    await user.click(await screen.findByRole("button", { name: /编辑|Edit/ }));
    await user.click(screen.getByRole("tab", { name: /Keys/ }));
    const keysPanel = activePanel();
    expect(document.body.innerHTML).not.toContain(secret);
    expect(document.body.innerHTML).not.toContain(backupSecret);
    const primaryRow = within(keysPanel).getByText("Primary").closest("li")!;
    await user.click(within(primaryRow).getByRole("button", { name: /显示完整值|Show full value/ }));
    expect(screen.getByDisplayValue(secret)).toBeInTheDocument();
    await user.click(within(primaryRow).getByRole("button", { name: /复制|Copy/ }));
    expect(clipboardSpy).toHaveBeenCalledWith(secret);
  });

  it("supports Key editing, status toggles, ordering, and individual tests", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: /编辑|Edit/ }));
    await user.click(screen.getByRole("tab", { name: /Keys/ }));
    const keysPanel = activePanel();
    const primaryRow = () => within(keysPanel).getByText("Primary").closest("li")!;
    await user.click(within(primaryRow()).getByRole("switch"));
    await waitFor(() => expect(actionMocks.updateApiKey).toHaveBeenCalledWith("api-1", "key-1", { enabled: false }));
    await user.click(within(primaryRow()).getByRole("button", { name: /下移|Move down/ }));
    await waitFor(() => expect(actionMocks.reorderApiKeys).toHaveBeenCalledWith("api-1", ["key-2", "key-1"]));
    await user.click(within(primaryRow()).getByRole("button", { name: /测试此 Key|Test this Key/ }));
    await waitFor(() => expect(actionMocks.testApiKey).toHaveBeenCalledWith("api-1", "key-1", "manual/large-model-id"));
    await user.click(within(keysPanel).getByRole("button", { name: /整体测试|Test all keys/ }));
    await waitFor(() => expect(actionMocks.testApiConnection).toHaveBeenCalledWith("api-1", "manual/large-model-id"));
    await user.click(within(primaryRow()).getByRole("button", { name: /^编辑$|^Edit$/ }));
    const keyInput = screen.getByLabelText(/完整 Key|Full Key/);
    await user.clear(keyInput);
    await user.type(keyInput, "replacement-fixture-value");
    await user.click(within(keysPanel).getByRole("button", { name: /^保存$|^Save$/ }));
    await waitFor(() => expect(actionMocks.updateApiKey).toHaveBeenCalledWith("api-1", "key-1", expect.objectContaining({ value: "replacement-fixture-value" })));
  });

  it("adds and deletes Keys through dedicated pending actions", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: /编辑|Edit/ }));
    await user.click(screen.getByRole("tab", { name: /Keys/ }));
    const keysPanel = activePanel();
    await user.click(within(keysPanel).getByRole("button", { name: /新增 Key|Add Key/ }));
    await user.type(screen.getByLabelText(/Key 标签|Key label/), "Rotation");
    const newKeyInput = screen.getByLabelText(/完整 Key|Full Key/);
    await user.type(newKeyInput, "fixture-new-key-value");
    const newKeyForm = newKeyInput.closest<HTMLElement>("div.grid")!;
    await user.click(within(newKeyForm).getByRole("button", { name: /^保存$|^Save$/ }));
    await waitFor(() => expect(actionMocks.addApiKey).toHaveBeenCalledWith("api-1", { label: "Rotation", value: "fixture-new-key-value", enabled: true }));

    const backupRow = within(keysPanel).getByText("Backup").closest("li")!;
    await user.click(within(backupRow).getByRole("button", { name: /^删除$|^Delete$/ }));
    const confirmTitle = await screen.findByRole("heading", { name: /删除.*Key|Delete.*Key/i });
    const confirm = confirmTitle.closest<HTMLElement>('[role="dialog"]')!;
    await user.click(within(confirm).getByRole("button", { name: /^删除$|^Delete$/ }));
    await waitFor(() => expect(actionMocks.deleteApiKey).toHaveBeenCalledWith("api-1", "key-2"));
  });

  it("refreshes models and surfaces referenced-model deletion without pretending success", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: /编辑|Edit/ }));
    await user.click(screen.getByRole("tab", { name: /模型|Models/ }));
    const modelsPanel = activePanel();
    await user.click(within(modelsPanel).getByRole("button", { name: /刷新上游列表|Refresh upstream/ }));
    expect(actionMocks.refreshApiModels).toHaveBeenCalledWith("api-1");
    const modelRow = screen.getByText("manual/large-model-id").closest("li")!;
    await user.click(within(modelRow).getByRole("button", { name: /^删除$|^Delete$/ }));
    const confirmTitle = await screen.findByRole("heading", { name: /删除.*模型|Delete.*model/i });
    const confirm = confirmTitle.closest<HTMLElement>('[role="dialog"]')!;
    await user.click(within(confirm).getByRole("button", { name: /^删除$|^Delete$/ }));
    await waitFor(() => expect(screen.getByText(/模型正在被能力插槽引用|referenced by a capability slot/)).toBeInTheDocument());
  });

  it("uses a confirmation dialog and preserves connection_in_use failures", async () => {
    actionMocks.deleteApiConnection.mockResolvedValue({ ok: false, error: { code: "connection_in_use", message: "safe" } });
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: /编辑|Edit/ }));
    const connectionDialog = screen.getByRole("dialog");
    await user.click(within(connectionDialog).getByText(/^删除$|^Delete$/).closest("button")!);
    const confirmTitle = await screen.findByRole("heading", { name: /删除.*连接|Delete.*connection/i });
    const confirm = confirmTitle.closest<HTMLElement>('[role="dialog"]')!;
    await user.click(within(confirm).getByRole("button", { name: /^删除$|^Delete$/ }));
    await waitFor(() => expect(actionMocks.deleteApiConnection).toHaveBeenCalledWith("api-1"));
  });
});
