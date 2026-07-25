import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { CliPluginsSection } from "../cli-plugins-section";
import { CLI_SECRET_MASK } from "@/lib/ai/cli-plugin-shared";

const actionMocks = vi.hoisted(() => ({
  listCliPlugins: vi.fn(),
  planNpmCliPlugin: vi.fn(),
  planLocalCliPlugin: vi.fn(),
  installCliPlugin: vi.fn(),
  reviewInstalledCliPlugin: vi.fn(),
  confirmAndEnableCliPlugin: vi.fn(),
  disableCliPlugin: vi.fn(),
  enableCliPlugin: vi.fn(),
  uninstallCliPlugin: vi.fn(),
  recoverCliPluginRegistry: vi.fn(),
  getCliPluginConnection: vi.fn(),
  saveCliPluginConnection: vi.fn(),
  testCliPluginConnection: vi.fn(),
  revealCliPluginSecret: vi.fn(),
}));

vi.mock("@/actions/cli-plugin-actions", () => actionMocks);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const plugin = {
  id: "@acme/community-cli",
  version: "1.2.3",
  source: "npm" as const,
  enabled: true,
  displayName: "Acme Community CLI",
  permissions: ["process:spawn"],
  permissionConfirmed: true,
  installedAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:00:00.000Z",
  health: "ready" as const,
  capabilities: { sessions: { fresh: true }, query: { generate: true }, models: true },
};

const safePlan = {
  planDigest: "sha256-safe-plan-digest-value",
  expiresAt: "2026-07-25T00:10:00.000Z",
  operation: "install" as const,
  pluginId: plugin.id,
  source: "npm" as const,
  fromVersion: null,
  toVersion: plugin.version,
  displayName: plugin.displayName,
  description: "Community provider",
  compatibility: { tower: ">=0.2.0", node: ">=20" },
  capabilities: plugin.capabilities,
  permissions: { requested: ["process:spawn"], added: ["process:spawn"], removed: [] },
};

function renderSection() {
  return render(<I18nProvider><CliPluginsSection /></I18nProvider>);
}

describe("CLI plugin settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.listCliPlugins.mockResolvedValue({ ok: true, data: [plugin] });
    actionMocks.installCliPlugin.mockResolvedValue({ ok: true, data: { ...plugin, enabled: false } });
    actionMocks.reviewInstalledCliPlugin.mockResolvedValue({ ok: true, data: safePlan });
    actionMocks.confirmAndEnableCliPlugin.mockResolvedValue({ ok: true, data: plugin });
    actionMocks.disableCliPlugin.mockResolvedValue({ ok: true, data: { disabled: true } });
    actionMocks.uninstallCliPlugin.mockResolvedValue({ ok: true, data: { uninstalled: true } });
    actionMocks.revealCliPluginSecret.mockResolvedValue({ ok: true, data: { value: "default" } });
  });

  it("reviews a safe permission diff before separate install and enable calls", async () => {
    const user = userEvent.setup();
    actionMocks.planNpmCliPlugin.mockResolvedValue({
      ok: true,
      data: safePlan,
    });
    renderSection();
    await screen.findByText(plugin.displayName);
    await user.click(screen.getByRole("button", { name: /添加 CLI 插件|Add CLI plugin/i }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/npm 包名|npm package/i), plugin.id);
    await user.type(within(dialog).getByLabelText(/精确版本|Exact version/i), plugin.version);
    await user.click(within(dialog).getByRole("button", { name: /审查安装计划|Review install plan/i }));
    await waitFor(() => expect(actionMocks.planNpmCliPlugin).toHaveBeenCalledWith(plugin.id, plugin.version));
    expect(await screen.findByText("process:spawn")).toBeInTheDocument();
    const plannedDialog = screen.getByRole("dialog");
    expect(within(plannedDialog).getByText(/新增|Added/i)).toBeInTheDocument();

    await user.click(within(plannedDialog).getByRole("button", { name: /安装（保持禁用）|Install disabled/i }));
    await waitFor(() => expect(actionMocks.installCliPlugin).toHaveBeenCalledWith("sha256-safe-plan-digest-value"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /确认权限并启用|Confirm permissions and enable/i }));
    await waitFor(() => expect(actionMocks.confirmAndEnableCliPlugin).toHaveBeenCalledWith("sha256-safe-plan-digest-value"));
  });

  it("recovers permission review for an installed plugin after client or server state is lost", async () => {
    const user = userEvent.setup();
    actionMocks.listCliPlugins.mockResolvedValue({
      ok: true,
      data: [{ ...plugin, enabled: false, permissionConfirmed: false, health: "disabled" }],
    });
    renderSection();
    await screen.findByText(plugin.displayName);
    expect(screen.getByText(/权限待确认|Permission review required/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /审查权限并启用|Review permissions and enable/i }));
    await waitFor(() => expect(actionMocks.reviewInstalledCliPlugin).toHaveBeenCalledWith(plugin.id));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText(/npm 包名|npm package/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/process:spawn/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /安装（保持禁用）|Install disabled/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /确认权限并启用|Confirm permissions and enable/i }));
    expect(actionMocks.installCliPlugin).toHaveBeenCalledWith(safePlan.planDigest);
    expect(actionMocks.confirmAndEnableCliPlugin).toHaveBeenCalledWith(safePlan.planDigest);
  });

  it("renders Tower-owned connection fields and schema controls", async () => {
    const user = userEvent.setup();
    actionMocks.getCliPluginConnection.mockResolvedValue({
      ok: true,
      data: {
        id: "connection-1",
        pluginId: plugin.id,
        name: plugin.displayName,
        enabled: true,
        commandOverride: null,
        baseArgs: [],
        envVars: [],
        settings: { profile: CLI_SECRET_MASK, active: true, mode: "safe", retries: 1 },
        configSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            profile: { type: "string", title: "Profile", "x-tower": { control: "text", sensitive: true } },
            active: { type: "boolean", title: "Active", "x-tower": { control: "switch" } },
            mode: { type: "string", title: "Mode", enum: ["safe", "fast"], "x-tower": { control: "select" } },
            retries: { type: "integer", title: "Retries", enum: [1, 2], "x-tower": { control: "select" } },
          },
          additionalProperties: false,
        },
        resolvedCommand: null,
        resolvedVersion: null,
        testStatus: "untested",
        testOk: false,
        models: ["community-fast", "community-safe"],
      },
    });
    actionMocks.testCliPluginConnection.mockResolvedValue({
      ok: true,
      data: {
        state: "connected",
        command: "/opt/acme/community-cli",
        version: "1.2.3",
        candidates: [{ path: "/opt/acme/community-cli", state: "connected", version: "1.2.3", source: "known-path" }],
        models: ["community-fast", "community-safe"],
      },
    });
    actionMocks.saveCliPluginConnection.mockImplementation(async (input) => ({
      ok: true,
      data: {
        ...(await actionMocks.getCliPluginConnection()).data,
        settings: input.settings,
      },
    }));
    renderSection();
    await screen.findByText(plugin.displayName);
    await user.click(screen.getByRole("button", { name: /^编辑$|^Edit$/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/命令覆盖|Command override/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/基础参数|Base arguments/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Profile")).toHaveAttribute("type", "password");
    expect(within(dialog).getByLabelText("Profile")).toHaveValue("••••••••");
    await user.click(within(dialog).getByRole("button", { name: /显示完整值|Show full value/i }));
    await waitFor(() => expect(actionMocks.revealCliPluginSecret).toHaveBeenCalledWith(
      "connection-1",
      { kind: "setting", key: "profile" },
    ));
    const revealedProfile = within(dialog).getByLabelText("Profile");
    await waitFor(() => expect(revealedProfile).toHaveValue("default"));
    expect(revealedProfile).not.toHaveAttribute("readonly");
    await user.clear(revealedProfile);
    await user.type(revealedProfile, "custom-profile");
    const copyValue = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(within(dialog).getByRole("button", { name: /^复制$|^Copy$/i }));
    expect(copyValue).toHaveBeenCalledWith("custom-profile");
    expect(within(dialog).getByText("Active")).toBeInTheDocument();
    expect(within(dialog).getByText("Mode")).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText("Retries"));
    await user.click(screen.getByRole("option", { name: "2" }));
    await user.click(within(dialog).getByRole("button", { name: /^保存$|^Save$/i }));
    await waitFor(() => expect(actionMocks.saveCliPluginConnection).toHaveBeenCalled());
    const savedSettings = actionMocks.saveCliPluginConnection.mock.calls[0]?.[0].settings;
    expect(savedSettings).toMatchObject({ retries: 2 });
    expect(typeof savedSettings.retries).toBe("number");
    expect(within(dialog).getByText("community-fast")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /测试连接|Test connection/i }));
    expect(await within(screen.getByRole("dialog")).findByText("/opt/acme/community-cli")).toBeInTheDocument();
  });

  it.each([
    ["disable", /禁用|Disable/i, "disableCliPlugin"],
    ["uninstall", /卸载|Uninstall/i, "uninstallCliPlugin"],
  ] as const)("confirms %s before mutating an installed plugin", async (_operation, label, actionName) => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(plugin.displayName);
    await user.click(screen.getByRole("button", { name: label }));
    const confirmation = screen.getByRole("dialog");
    await user.click(within(confirmation).getByRole("button", { name: /确认|Confirm/i }));

    await waitFor(() => expect(actionMocks[actionName]).toHaveBeenCalledWith(plugin.id));
  });
});
