import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { CapabilitySlotsSection } from "../capability-slots-section";

const slots = ["terminal", "summary", "dreaming", "analysis", "assistant"];
const cli = { id: "cli-1", connectionKey: "cli:codex", name: "Codex", kind: "cli", provider: "codex", enabled: true, testStatus: "connected", testOk: true, defaultModelId: null, models: [] };
const api = { id: "api-1", connectionKey: null, name: "API", kind: "api", provider: "openai-compatible", enabled: true, testStatus: "connected", testOk: true, defaultModelId: "model-a", models: [{ modelId: "model-a", source: "manual", available: true }] };

const actionMocks = vi.hoisted(() => ({
  listAiCapabilities: vi.fn(), getAiCapabilityChoices: vi.fn(), getAiCapabilityDiagnostics: vi.fn(),
  replaceAiCapabilityTargets: vi.fn(), getConfigValue: vi.fn(), setConfigValue: vi.fn(),
}));

vi.mock("@/actions/ai-config-actions", () => ({
  listAiCapabilities: actionMocks.listAiCapabilities,
  getAiCapabilityChoices: actionMocks.getAiCapabilityChoices,
  getAiCapabilityDiagnostics: actionMocks.getAiCapabilityDiagnostics,
  replaceAiCapabilityTargets: actionMocks.replaceAiCapabilityTargets,
}));
vi.mock("@/actions/config-actions", () => ({ getConfigValue: actionMocks.getConfigValue, setConfigValue: actionMocks.setConfigValue }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function configs(overrides: Record<string, unknown> = {}) {
  return slots.map((slot) => ({ id: `${slot}-config`, slot, provider: "claude", mode: "cli", model: null, migrationStatus: "complete", createdAt: new Date(), updatedAt: new Date(), targets: [], ...(overrides[slot] as object ?? {}) }));
}

function renderSection() {
  return render(<I18nProvider><CapabilitySlotsSection /></I18nProvider>);
}

describe("CapabilitySlotsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.listAiCapabilities.mockResolvedValue({ ok: true, data: configs() });
    actionMocks.getAiCapabilityChoices.mockImplementation(async (slot: string) => ({ ok: true, data: slot === "terminal" ? [cli] : [cli, api] }));
    actionMocks.getAiCapabilityDiagnostics.mockResolvedValue({ ok: true, data: [] });
    actionMocks.getConfigValue.mockImplementation(async (key: string) => key === "assistant.effort" ? "low" : 20);
    actionMocks.setConfigValue.mockResolvedValue(undefined);
    actionMocks.replaceAiCapabilityTargets.mockResolvedValue({ ok: true, data: {} });
  });

  it("renders exactly five direct Primary and Fallback selectors without a fabricated Claude target", async () => {
    renderSection();
    expect(await screen.findAllByLabelText("Primary")).toHaveLength(5);
    expect(screen.getAllByLabelText("Fallback")).toHaveLength(5);
    expect(screen.queryByText(/^Claude$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /新增目标|Add target/ })).not.toBeInTheDocument();
    for (const title of [/终端执行|Terminal/, /任务摘要|Task Summary/, /知识沉淀|Knowledge Insights/, /项目分析|Project Analysis/, /AI 助手|AI Assistant/]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    }
  });

  it("filters API connections out of the Terminal Primary selector", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findAllByLabelText("Primary");
    const terminal = screen.getByText(/终端执行|Terminal/).closest("article")!;
    await user.click(within(terminal).getByLabelText("Primary"));
    expect(await screen.findByRole("option", { name: /Codex/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /API/ })).not.toBeInTheDocument();
  });

  it("does not offer disabled provider connections for a new target", async () => {
    const disabled = { ...cli, id: "cli-disabled", name: "Qwen Code", enabled: false, testStatus: "unavailable", testOk: false };
    actionMocks.getAiCapabilityChoices.mockResolvedValue({ ok: true, data: [cli, disabled] });
    const user = userEvent.setup();
    renderSection();
    await screen.findAllByLabelText("Primary");
    const assistant = screen.getByText(/AI 助手|AI Assistant/).closest("article")!;
    await user.click(within(assistant).getByLabelText("Primary"));
    expect(await screen.findByRole("option", { name: /Codex/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Qwen Code/ })).not.toBeInTheDocument();
  });

  it("selects an API connection and model as one Primary suite", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findAllByLabelText("Primary");
    const summary = screen.getByText(/任务摘要|Task Summary/).closest("article")!;
    await user.click(within(summary).getByLabelText("Primary"));
    await user.click(await screen.findByRole("option", { name: /API · model-a/ }));
    await waitFor(() => expect(actionMocks.replaceAiCapabilityTargets).toHaveBeenCalledWith("summary", [{
      connectionId: "api-1",
      modelId: "model-a",
    }]));
  });

  it("updates the fixed Fallback directly without reordering controls", async () => {
    const targets = [
      { id: "target-1", connectionId: "cli-1", modelId: null, order: 0, connection: cli },
      { id: "target-2", connectionId: "api-1", modelId: "model-a", order: 1, connection: api },
    ];
    actionMocks.listAiCapabilities.mockResolvedValue({ ok: true, data: configs({ summary: { targets } }) });
    const user = userEvent.setup();
    renderSection();
    const summary = (await screen.findByText(/任务摘要|Task Summary/)).closest("article")!;
    expect(within(summary).queryByRole("button", { name: /上移目标|Move target up/ })).not.toBeInTheDocument();
    await user.click(within(summary).getByLabelText("Fallback"));
    await user.click(await screen.findByRole("option", { name: /不使用备用套件|No fallback suite/ }));
    await waitFor(() => expect(actionMocks.replaceAiCapabilityTargets).toHaveBeenCalledWith("summary", [{
      targetId: "target-1",
      connectionId: "cli-1",
      modelId: null,
    }]));
  });

  it("shows migration and unavailable diagnostics without prompt or secret fields", async () => {
    const broken = { ...api, enabled: false, testStatus: "unavailable", testOk: false };
    actionMocks.listAiCapabilities.mockResolvedValue({ ok: true, data: configs({ summary: { migrationStatus: "legacy_api_unmapped", targets: [{ id: "target-1", connectionId: "api-1", modelId: "missing", order: 0, connection: broken }] } }) });
    actionMocks.getAiCapabilityChoices.mockImplementation(async (slot: string) => ({ ok: true, data: slot === "terminal" ? [cli] : [cli, broken] }));
    actionMocks.getAiCapabilityDiagnostics.mockResolvedValue({ ok: true, data: [{ id: "attempt-1", slot: "summary", targetId: "target-1", connectionId: "api-1", modelId: "missing", startedAt: new Date(), durationMs: 18, result: "failed", errorCode: "connection_unavailable", requestId: "request-1", correlationId: null, repaired: false }] });
    const view = renderSection();
    expect(await screen.findByText(/旧配置无法确定|legacy configuration/)).toBeInTheDocument();
    expect(screen.getByText(/连接已停用|Connection is disabled/)).toBeInTheDocument();
    expect(view.container.innerHTML).not.toMatch(/prompt|api.?key/i);
  });

  it("keeps Assistant effort while model selection stays on explicit targets", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findAllByLabelText("Primary");
    await user.click(screen.getByLabelText(/思考等级|Thinking effort/));
    await user.click(await screen.findByText(/平衡|Balanced/));
    expect(actionMocks.setConfigValue).toHaveBeenCalledWith("assistant.effort", "medium");
    expect(actionMocks.setConfigValue).not.toHaveBeenCalledWith("assistant.model", expect.anything());
  });

  it("persists the Assistant conversation history window independently", async () => {
    const user = userEvent.setup();
    renderSection();
    const input = await screen.findByLabelText(/保留对话轮次|Conversation history/);
    await user.clear(input);
    await user.type(input, "42");
    await user.tab();
    expect(actionMocks.setConfigValue).toHaveBeenCalledWith("assistant.historyTurns", 20);
    expect(actionMocks.setConfigValue).not.toHaveBeenCalledWith("assistant.maxTurns", expect.anything());
  });

  it("normalizes an existing Assistant history value to the new maximum", async () => {
    actionMocks.getConfigValue.mockImplementation(async (key: string) =>
      key === "assistant.effort" ? "low" : 100);
    renderSection();
    expect(await screen.findByLabelText(/保留对话轮次|Conversation history/)).toHaveValue(20);
  });
});
