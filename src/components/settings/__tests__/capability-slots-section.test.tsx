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
  addAiCapabilityTarget: vi.fn(), updateAiCapabilityTarget: vi.fn(), deleteAiCapabilityTarget: vi.fn(),
  reorderAiCapabilityTargets: vi.fn(), getConfigValue: vi.fn(), setConfigValue: vi.fn(),
}));

vi.mock("@/actions/ai-config-actions", () => ({
  listAiCapabilities: actionMocks.listAiCapabilities,
  getAiCapabilityChoices: actionMocks.getAiCapabilityChoices,
  getAiCapabilityDiagnostics: actionMocks.getAiCapabilityDiagnostics,
  addAiCapabilityTarget: actionMocks.addAiCapabilityTarget,
  updateAiCapabilityTarget: actionMocks.updateAiCapabilityTarget,
  deleteAiCapabilityTarget: actionMocks.deleteAiCapabilityTarget,
  reorderAiCapabilityTargets: actionMocks.reorderAiCapabilityTargets,
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
    actionMocks.addAiCapabilityTarget.mockResolvedValue({ ok: true, data: {} });
    actionMocks.updateAiCapabilityTarget.mockResolvedValue({ ok: true, data: {} });
    actionMocks.deleteAiCapabilityTarget.mockResolvedValue({ ok: true, data: {} });
    actionMocks.reorderAiCapabilityTargets.mockResolvedValue({ ok: true, data: {} });
  });

  it("renders exactly five unconfigured slots without a fabricated Claude target", async () => {
    renderSection();
    expect(await screen.findAllByText(/未配置目标|No targets configured/)).toHaveLength(5);
    expect(screen.queryByText(/^Claude$/)).not.toBeInTheDocument();
    for (const title of [/终端执行|Terminal/, /任务摘要|Task Summary/, /知识沉淀|Knowledge Insights/, /项目分析|Project Analysis/, /AI 助手|AI Assistant/]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    }
  });

  it("filters API connections out of the Terminal target editor", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findAllByText(/未配置目标|No targets configured/);
    const terminal = screen.getByText(/终端执行|Terminal/).closest("article")!;
    await user.click(within(terminal).getByRole("button", { name: /新增目标|Add target/ }));
    await user.click(screen.getByLabelText(/连接|Connection/));
    expect(await screen.findByText(/Codex · CLI/)).toBeInTheDocument();
    expect(screen.queryByText(/API · API/)).not.toBeInTheDocument();
  });

  it("does not offer disabled provider connections for a new target", async () => {
    const disabled = { ...cli, id: "cli-disabled", name: "Qwen Code", enabled: false, testStatus: "unavailable", testOk: false };
    actionMocks.getAiCapabilityChoices.mockResolvedValue({ ok: true, data: [cli, disabled] });
    const user = userEvent.setup();
    renderSection();
    await screen.findAllByText(/未配置目标|No targets configured/);
    const assistant = screen.getByText(/AI 助手|AI Assistant/).closest("article")!;
    await user.click(within(assistant).getByRole("button", { name: /新增目标|Add target/ }));
    await user.click(screen.getByLabelText(/连接|Connection/));
    expect(await screen.findByRole("option", { name: /Codex · CLI/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Qwen Code/ })).not.toBeInTheDocument();
  });

  it("requires an API model before saving a non-terminal target", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findAllByText(/未配置目标|No targets configured/);
    const summary = screen.getByText(/任务摘要|Task Summary/).closest("article")!;
    await user.click(within(summary).getByRole("button", { name: /新增目标|Add target/ }));
    await user.click(screen.getByLabelText(/连接|Connection/));
    await user.click(await screen.findByRole("option", { name: /API · API/ }));
    await user.click(screen.getByRole("button", { name: /^保存$|^Save$/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/API 目标必须选择模型|API targets require a model/);
    expect(actionMocks.addAiCapabilityTarget).not.toHaveBeenCalled();
  });

  it("labels primary and ordered fallbacks and supports reordering", async () => {
    const targets = [
      { id: "target-1", connectionId: "cli-1", modelId: null, order: 0, connection: cli },
      { id: "target-2", connectionId: "api-1", modelId: "model-a", order: 1, connection: api },
    ];
    actionMocks.listAiCapabilities.mockResolvedValue({ ok: true, data: configs({ summary: { targets } }) });
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByText("Primary")).toBeInTheDocument();
    expect(screen.getByText(/Fallback 1/)).toBeInTheDocument();
    const fallback = screen.getByText(/Fallback 1/).closest("li")!;
    await user.click(within(fallback).getByRole("button", { name: /上移目标|Move target up/ }));
    await waitFor(() => expect(actionMocks.reorderAiCapabilityTargets).toHaveBeenCalledWith("summary", ["target-2", "target-1"]));
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
    await screen.findAllByText(/未配置目标|No targets configured/);
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
    expect(actionMocks.setConfigValue).toHaveBeenCalledWith("assistant.historyTurns", 42);
    expect(actionMocks.setConfigValue).not.toHaveBeenCalledWith("assistant.maxTurns", expect.anything());
  });
});
