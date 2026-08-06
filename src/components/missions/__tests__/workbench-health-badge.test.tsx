import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveExecutionInfo } from "@/actions/agent-actions";
import { I18nProvider } from "@/lib/i18n";
import { WorkbenchHealthBadge } from "../workbench-health-badge";

type WorkbenchRuntime = NonNullable<ActiveExecutionInfo["workbenchRuntime"]>;

const now = new Date("2026-08-04T10:00:00.000Z").getTime();

function runtime(overrides: Partial<WorkbenchRuntime> = {}): WorkbenchRuntime {
  return {
    executionId: "execution-current",
    runtimeExecutionId: "execution-current",
    syncState: "CURRENT",
    generation: 7,
    state: "IDLE",
    activeBatchId: null,
    pendingEvents: 0,
    lastHeartbeatAt: new Date(now - 5_000).toISOString(),
    blockedReason: null,
    lastError: null,
    ...overrides,
  };
}

function renderBadge(workbenchRuntime: WorkbenchRuntime | null) {
  return render(
    <I18nProvider>
      <WorkbenchHealthBadge
        isSystemTask
        workbenchRuntime={workbenchRuntime}
      />
    </I18nProvider>,
  );
}

describe("WorkbenchHealthBadge", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(Date, "now").mockReturnValue(now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a compact Chinese status and localized heartbeat details", async () => {
    const user = userEvent.setup();
    renderBadge(runtime());

    const badge = screen.getByText("工作台 · 空闲");
    expect(badge).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("G7");
    expect(document.body).not.toHaveTextContent(/generation/i);

    await user.hover(badge);
    expect(await screen.findByText("状态")).toBeInTheDocument();
    expect(screen.getByText("待处理")).toBeInTheDocument();
    expect(screen.getByText("最近心跳")).toBeInTheDocument();
    expect(screen.getByText(/5秒(?:钟)?前/)).toBeInTheDocument();
    expect(screen.getByText(/2026年8月4日/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("G7");
    expect(document.body).not.toHaveTextContent(/generation/i);
  });

  it("renders English labels and only appends a positive pending count", async () => {
    localStorage.setItem("locale", "en");
    const user = userEvent.setup();
    renderBadge(runtime({
      state: "BUSY",
      activeBatchId: "batch-123",
      pendingEvents: 3,
      blockedReason: "Provider turn in progress",
    }));

    const badge = await screen.findByText("Workbench · Busy · 3");
    await user.hover(badge);
    expect(await screen.findByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Last heartbeat")).toBeInTheDocument();
    expect(screen.getByText("Current batch")).toBeInTheDocument();
    expect(screen.getByText("AI is processing the current request")).toBeInTheDocument();
    expect(screen.getByText(/5 seconds ago/)).toBeInTheDocument();
    expect(screen.getByText(/Aug 4, 2026/)).toBeInTheDocument();
  });

  it("localizes known failures and shows errors and stale-heartbeat notices", async () => {
    const user = userEvent.setup();
    renderBadge(runtime({
      state: "BLOCKED",
      pendingEvents: 2,
      lastHeartbeatAt: new Date(now - 20_000).toISOString(),
      blockedReason: "Workbench reconciliation failed",
      lastError: "Connection reset",
    }));

    const badge = screen.getByText("工作台 · 阻塞 · 2");
    await user.hover(badge);
    expect(await screen.findByText("工作台状态恢复失败")).toBeInTheDocument();
    expect(screen.getByText("Connection reset")).toBeInTheDocument();
    expect(screen.getByText("工作台心跳已滞后")).toBeInTheDocument();
  });

  it("falls back to an unknown backend reason without exposing generation", async () => {
    const user = userEvent.setup();
    renderBadge(runtime({
      state: "BLOCKED",
      blockedReason: "A future backend reason",
    }));

    const badge = screen.getByText("工作台 · 阻塞");
    await user.hover(badge);
    expect(await screen.findByText("A future backend reason")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("G7");
    expect(document.body).not.toHaveTextContent(/generation/i);
  });
});
