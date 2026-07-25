import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { ConnectionsSection } from "../connections-section";

const actionMocks = vi.hoisted(() => ({
  getAvailableProviders: vi.fn(),
  getProviderConnections: vi.fn(),
  setCliProviderEnabled: vi.fn(),
}));

vi.mock("@/actions/ai-config-actions", () => ({
  getAvailableProviders: actionMocks.getAvailableProviders,
}));
vi.mock("@/actions/provider-connection-actions", () => ({
  getProviderConnections: actionMocks.getProviderConnections,
  setCliProviderEnabled: actionMocks.setCliProviderEnabled,
}));
vi.mock("../api-connections-section", () => ({
  ApiConnectionsSection: () => <div data-testid="api-connections" />,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const providers = [
  {
    name: "claude",
    displayName: "Claude Code",
    builtin: true,
    cli: { available: true, version: "2.4.1", commandPath: "/opt/tower/bin/claude", commandState: "runnable" },
    api: { available: false, keyConfigured: false },
  },
  {
    name: "codex",
    displayName: "Codex CLI",
    builtin: true,
    cli: { available: false, version: null, commandPath: null, commandState: "not-found" },
    api: { available: false, keyConfigured: false },
  },
  {
    name: "gemini",
    displayName: "Gemini CLI",
    builtin: true,
    cli: { available: false, version: null, commandPath: "/usr/local/bin/gemini", commandState: "found" },
    api: { available: false, keyConfigured: false },
  },
  {
    name: "acme",
    displayName: "Acme Extension",
    builtin: false,
    cli: { available: true, version: "1.0.0", commandPath: "/opt/acme/bin/acme", commandState: "runnable" },
    api: { available: false, keyConfigured: false },
  },
  {
    name: "lab",
    displayName: "Lab Extension",
    builtin: false,
    cli: { available: true, version: null, commandPath: "/opt/lab/bin/lab", commandState: "runnable" },
    api: { available: false, keyConfigured: false },
  },
] as const;

function connection(provider: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `connection-${provider}`,
    connectionKey: `cli:${provider}`,
    name: provider,
    kind: "cli",
    provider,
    enabled: true,
    testStatus: "connected",
    lastTestedAt: new Date("2026-07-25T00:00:00Z"),
    testOk: true,
    version: "1.0.0",
    mcpInstalled: true,
    hooksInstalled: true,
    skillsInstalled: true,
    installLog: null,
    ...overrides,
  };
}

let persisted: ReturnType<typeof connection>[];

function renderSection() {
  return render(<I18nProvider><ConnectionsSection /></I18nProvider>);
}

function providerRow(name: string) {
  return screen.getByText(name).closest("li")!;
}

describe("ConnectionsSection CLI connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persisted = [
      connection("claude", { hooksInstalled: false }),
      connection("acme", { testStatus: "unavailable", testOk: false }),
      connection("gemini", { testStatus: "untested", lastTestedAt: null, testOk: false }),
    ];
    actionMocks.getAvailableProviders.mockResolvedValue(providers);
    actionMocks.getProviderConnections.mockImplementation(async () => persisted);
    actionMocks.setCliProviderEnabled.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("labels builtin and extension providers and maps command plus persisted states", async () => {
    renderSection();
    await screen.findByText("Claude Code");

    for (const name of ["Claude Code", "Codex CLI", "Gemini CLI"]) {
      expect(within(providerRow(name)).getByText(/^(内置|Built-in)$/)).toBeInTheDocument();
    }
    for (const name of ["Acme Extension", "Lab Extension"]) {
      expect(within(providerRow(name)).getByText(/^(扩展|Extension)$/)).toBeInTheDocument();
    }
    expect(within(providerRow("Codex CLI")).getByText(/未安装|Not installed/)).toBeInTheDocument();
    expect(within(providerRow("Gemini CLI")).getByText(/不可执行|Not executable/)).toBeInTheDocument();
    expect(within(providerRow("Claude Code")).getByText(/已连接|Connected/)).toBeInTheDocument();
    expect(within(providerRow("Acme Extension")).getByText(/不可用|Unavailable/)).toBeInTheDocument();
    expect(within(providerRow("Lab Extension")).getByText(/未测试|Untested/)).toBeInTheDocument();
    expect(within(providerRow("Claude Code")).getByText("/opt/tower/bin/claude")).toBeInTheDocument();
  });

  it("shows MCP, Hooks, Skills and a readable degraded state", async () => {
    renderSection();
    await screen.findByText("Claude Code");
    const row = providerRow("Claude Code");

    expect(within(row).getByText("MCP")).toBeInTheDocument();
    expect(within(row).getByText("HOOKS")).toBeInTheDocument();
    expect(within(row).getByText("Skills")).toBeInTheDocument();
    expect(within(row).getByText(/部分.*集成未完成|integrations are incomplete/)).toBeInTheDocument();
  });

  it("posts a connection test and refreshes the persisted status", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => {
      persisted = persisted.map((row) => row.provider === "acme"
        ? connection("acme", { testStatus: "connected", testOk: true })
        : row);
      return {
        json: async () => ({
          ok: true,
          checks: [{ name: "hello", passed: true, message: "Hello probe passed" }],
          install: { ok: true },
        }),
      } as Response;
    });
    renderSection();
    await screen.findByText("Acme Extension");
    const row = providerRow("Acme Extension");

    await user.click(within(row).getByRole("button", { name: /测试连接|Test Connection/ }));

    expect(fetchMock).toHaveBeenCalledWith("/api/adapters/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "acme" }),
    });
    await waitFor(() => expect(actionMocks.getProviderConnections).toHaveBeenCalledTimes(2));
    expect(within(row).getByText(/已连接|Connected/)).toBeInTheDocument();
    expect(within(row).getByText("Hello probe passed")).toBeInTheDocument();
  });

  it("replaces transport exceptions with a safe message", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockRejectedValue(new Error("unsafe-secret-fixture"));
    const view = renderSection();
    await screen.findByText("Acme Extension");
    const row = providerRow("Acme Extension");

    await user.click(within(row).getByRole("button", { name: /测试连接|Test Connection/ }));

    expect(await within(row).findByText(/仅显示安全原因|only a safe reason/)).toBeInTheDocument();
    expect(view.container.innerHTML).not.toContain("unsafe-secret-fixture");
  });

  it("disables untested toggles and calls the action for a tested connection", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Claude Code");

    expect(within(providerRow("Lab Extension")).getByRole("switch")).toHaveAttribute("aria-disabled", "true");
    expect(within(providerRow("Gemini CLI")).getByRole("switch")).toHaveAttribute("aria-disabled", "true");
    const testedSwitch = within(providerRow("Claude Code")).getByRole("switch");
    expect(testedSwitch).toBeEnabled();
    await user.click(testedSwitch);
    await waitFor(() => expect(actionMocks.setCliProviderEnabled).toHaveBeenCalledWith("claude", false));
  });
});
