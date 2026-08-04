import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  getControl: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/actions/unattended-goal-actions", () => ({
  getUnattendedGoalControl: mocks.getControl,
  enableUnattendedGoalFromUi: mocks.enable,
  disableUnattendedGoalFromUi: mocks.disable,
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/components/ui/tooltip", async () => {
  const React = await import("react");
  return {
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ render, children }: { render: React.ReactElement; children: React.ReactNode }) =>
      React.cloneElement(render, {}, children),
    TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  };
});

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { UnattendedGoalControl } from "@/components/task/unattended-goal-control";

const inactive = {
  active: false,
  runtime: null,
  ownerMessageGrant: null,
  capabilities: [{
    capability: "human.message.send",
    lane: "DIRECT",
    risk: "R2",
    available: true,
    description: "Send a message",
    authorization: { authorizationRef: null },
  }],
};

const active = {
  ...inactive,
  active: true,
  ownerMessageGrant: { authorizationRef: "grant-1", remainingUses: 19 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function renderControl() {
  return render(<I18nProvider><UnattendedGoalControl taskId="task-1" /></I18nProvider>);
}

describe("UnattendedGoalControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getControl.mockResolvedValue(inactive);
    mocks.enable.mockResolvedValue({ active: true });
    mocks.disable.mockResolvedValue({ active: false });
  });

  afterEach(cleanup);

  it("renders loading, inactive, enabling, and active states without a duplicate enable", async () => {
    const initialLoad = deferred<typeof inactive>();
    const enableCall = deferred<{ active: boolean }>();
    mocks.getControl
      .mockReturnValueOnce(initialLoad.promise)
      .mockResolvedValueOnce(active);
    mocks.enable.mockReturnValueOnce(enableCall.promise);
    const user = userEvent.setup();

    renderControl();
    expect(screen.getByRole("button", { name: "加载无人值守状态" })).toBeDisabled();

    initialLoad.resolve(inactive);
    const trigger = await screen.findByRole("button", { name: "启用无人值守" });
    await user.click(trigger);
    const submit = screen.getByRole("button", { name: "确认启用" });
    await user.dblClick(submit);

    expect(mocks.enable).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-busy", "true");

    enableCall.resolve({ active: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "无人值守已授权" })).toBeEnabled());
    expect(mocks.toastSuccess).toHaveBeenCalledWith("无人值守已启用");
  });

  it("renders disabling state and prevents a duplicate disable", async () => {
    const disableCall = deferred<{ active: boolean }>();
    mocks.getControl
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(inactive);
    mocks.disable.mockReturnValueOnce(disableCall.promise);
    const user = userEvent.setup();

    renderControl();
    await user.click(await screen.findByRole("button", { name: "无人值守已授权" }));
    const submit = screen.getByRole("button", { name: "确认关闭" });
    await user.dblClick(submit);

    expect(mocks.disable).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-busy", "true");

    disableCall.resolve({ active: false });
    await waitFor(() => expect(screen.getByRole("button", { name: "启用无人值守" })).toBeEnabled());
  });

  it("keeps an explicit accessible failure state in the dialog and allows retry", async () => {
    mocks.enable
      .mockRejectedValueOnce(new Error("OWNER route temporarily unavailable"))
      .mockResolvedValueOnce({ active: true });
    mocks.getControl
      .mockResolvedValueOnce(inactive)
      .mockResolvedValueOnce(active);
    const user = userEvent.setup();

    renderControl();
    await user.click(await screen.findByRole("button", { name: "启用无人值守" }));
    const submit = screen.getByRole("button", { name: "确认启用" });
    await user.click(submit);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("OWNER route temporarily unavailable");
    expect(submit).toBeEnabled();
    expect(mocks.toastError).toHaveBeenCalledWith("OWNER route temporarily unavailable");

    await user.click(submit);
    await waitFor(() => expect(screen.getByRole("button", { name: "无人值守已授权" })).toBeEnabled());
    expect(mocks.enable).toHaveBeenCalledTimes(2);
  });

  it("exposes a persistent load-failure retry state", async () => {
    mocks.getControl
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(inactive);
    const user = userEvent.setup();

    renderControl();
    const retry = await screen.findByRole("button", { name: "重试无人值守状态" });
    expect(retry).toBeEnabled();
    await user.click(retry);
    await waitFor(() => expect(screen.getByRole("button", { name: "启用无人值守" })).toBeEnabled());
  });
});
