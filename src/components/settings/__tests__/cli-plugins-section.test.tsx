import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { CliPluginsSection, invalidateCliPluginCache } from "../cli-plugins-section";
import { CLI_SECRET_MASK } from "@/lib/ai/cli-plugin-shared";

const actionMocks = vi.hoisted(() => ({
  listCliPlugins: vi.fn(),
  listCliProviderCatalog: vi.fn(),
  planCatalogCliPlugin: vi.fn(),
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
vi.mock("@/components/layout/folder-browser-dialog", async () => {
  const { createPortal } = await import("react-dom");
  return {
    FolderBrowserDialog: ({ open, onSelect }: { open: boolean; onSelect(path: string): void }) => open
      ? createPortal(<button type="button" onClick={() => onSelect("/tmp/qwen-provider-dev")}>Pick fixture directory</button>, document.body)
      : null,
  };
});

const dependency = {
  dependency: "Qwen Code CLI",
  state: "ready" as const,
  commandPath: "/opt/homebrew/bin/qwen",
  detectedVersion: "0.18.0",
  supportedVersions: ">=0.18.0 <1.0.0",
  homepage: "https://qwenlm.github.io/qwen-code-docs/",
  installDocs: "https://qwenlm.github.io/qwen-code-docs/en/users/installation/",
  managedByTower: false as const,
};

const plugin = {
  id: "community.qwen-code",
  version: "0.1.0",
  source: "catalog" as const,
  enabled: true,
  displayName: "Qwen Code",
  permissions: ["process:spawn", "network:provider"],
  permissionConfirmed: true,
  installedAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:00:00.000Z",
  health: "ready" as const,
  dependency,
  capabilities: {
    sessions: { fresh: true, resume: true, continue: true },
    query: { generate: true, stream: true },
    models: false,
    integrations: { mcp: false, hooks: false, skills: false },
  },
};

const catalogItem = {
  id: plugin.id,
  kind: "cli-provider" as const,
  publisher: { id: "tower-community", name: "Tower Community" },
  display: {
    name: plugin.displayName,
    description: "Use an existing Qwen Code CLI installation from Tower.",
    homepage: dependency.homepage,
  },
  latestVersion: plugin.version,
  versions: [{
    version: plugin.version,
    cliDependency: {
      name: dependency.dependency,
      command: "qwen",
      versionArgs: ["--version"],
      supportedVersions: dependency.supportedVersions,
      homepage: dependency.homepage,
      installDocs: dependency.installDocs,
      managedByTower: false as const,
    },
  }],
  installed: plugin,
  updateAvailable: false,
};

const safePlan = {
  planDigest: "sha256-safe-plan-digest-value",
  expiresAt: "2026-07-25T00:10:00.000Z",
  operation: "install" as const,
  pluginId: plugin.id,
  source: "catalog" as const,
  fromVersion: null,
  toVersion: plugin.version,
  displayName: plugin.displayName,
  description: catalogItem.display.description,
  publisher: catalogItem.publisher,
  cliDependency: catalogItem.versions[0].cliDependency,
  dependency,
  compatibility: { tower: ">=0.2.0", node: ">=20" },
  capabilities: plugin.capabilities,
  permissions: {
    requested: ["process:spawn", "network:provider"],
    added: ["process:spawn", "network:provider"],
    removed: [],
  },
};

function renderSection() {
  return render(<I18nProvider><CliPluginsSection /></I18nProvider>);
}

describe("CLI plugin settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCliPluginCache();
    actionMocks.listCliPlugins.mockResolvedValue({ ok: true, data: [plugin] });
    actionMocks.listCliProviderCatalog.mockResolvedValue({ ok: true, data: [catalogItem] });
    actionMocks.installCliPlugin.mockResolvedValue({ ok: true, data: { ...plugin, enabled: false } });
    actionMocks.reviewInstalledCliPlugin.mockResolvedValue({ ok: true, data: safePlan });
    actionMocks.confirmAndEnableCliPlugin.mockResolvedValue({ ok: true, data: plugin });
    actionMocks.disableCliPlugin.mockResolvedValue({ ok: true, data: { disabled: true } });
    actionMocks.uninstallCliPlugin.mockResolvedValue({ ok: true, data: { uninstalled: true } });
    actionMocks.revealCliPluginSecret.mockResolvedValue({ ok: true, data: { value: "default" } });
  });

  it("loads and searches the CLI provider catalog", async () => {
    const user = userEvent.setup();

    renderSection();
    expect(await screen.findByText(plugin.displayName)).toBeInTheDocument();
    expect(screen.getByText(/Tower 不负责安装或登录|Tower does not install or sign in/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tool Provider" }));
    expect(await screen.findByText(/暂无此类型扩展|No extensions of this type/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "CLI Provider" }));
    expect(await screen.findByText(plugin.displayName)).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: /搜索 Provider Catalog|Search provider catalog/i }), "not-found");
    expect(await screen.findByText(/没有匹配的 Provider|No matching providers/i)).toBeInTheDocument();
    expect(actionMocks.listCliProviderCatalog).toHaveBeenCalledTimes(1);
    expect(actionMocks.listCliProviderCatalog).toHaveBeenCalledWith("");
  });

  it("reuses extension data when the settings section remounts", async () => {
    const first = renderSection();
    await screen.findByText(plugin.displayName);
    await waitFor(() => {
      expect(actionMocks.listCliPlugins).toHaveBeenCalledTimes(1);
      expect(actionMocks.listCliProviderCatalog).toHaveBeenCalledTimes(1);
    });
    first.unmount();

    renderSection();
    expect(await screen.findByText(plugin.displayName)).toBeInTheDocument();
    expect(actionMocks.listCliPlugins).toHaveBeenCalledTimes(1);
    expect(actionMocks.listCliProviderCatalog).toHaveBeenCalledTimes(1);
  });

  it("fetches the catalog again only when refresh is requested", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(plugin.displayName);
    await user.click(screen.getByRole("button", { name: /刷新 Catalog|Refresh Catalog/i }));

    await waitFor(() => expect(actionMocks.listCliProviderCatalog).toHaveBeenCalledTimes(2));
    expect(actionMocks.listCliPlugins).toHaveBeenCalledTimes(1);
  });

  it("renders a safe catalog-unavailable state", async () => {
    actionMocks.listCliProviderCatalog.mockResolvedValue({
      ok: false,
      error: { code: "catalog_unavailable", message: "https://private.invalid/catalog.json failed" },
    });

    renderSection();
    expect(await screen.findByText(/尚未配置扩展 Catalog|Extension catalog not configured/i)).toBeInTheDocument();
    expect(screen.queryByText(/private\.invalid/)).not.toBeInTheDocument();
  });

  it("reviews a catalog plan before separate disabled install and permission enable calls", async () => {
    const user = userEvent.setup();
    const availableItem = { ...catalogItem, installed: null };
    actionMocks.listCliPlugins.mockResolvedValue({ ok: true, data: [] });
    actionMocks.listCliProviderCatalog.mockResolvedValue({ ok: true, data: [availableItem] });
    actionMocks.planCatalogCliPlugin.mockResolvedValue({
      ok: true,
      data: safePlan,
    });
    renderSection();
    await screen.findByText(plugin.displayName);
    await user.click(screen.getByRole("button", { name: /^安装$|^Install$/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText(/npm 包名|npm package/i)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /审查安装计划|Review install plan/i }));
    await waitFor(() => expect(actionMocks.planCatalogCliPlugin).toHaveBeenCalledWith(plugin.id, plugin.version));
    expect(await within(dialog).findByText(/process:spawn/)).toBeInTheDocument();
    expect(within(dialog).getByText(/network:provider/)).toBeInTheDocument();
    expect(within(dialog).getByText("Tower Community")).toBeInTheDocument();
    const plannedDialog = screen.getByRole("dialog");
    expect(within(plannedDialog).getAllByText(/新增|Added/i)).toHaveLength(2);

    await user.click(within(plannedDialog).getByRole("button", { name: /安装（保持禁用）|Install disabled/i }));
    await waitFor(() => expect(actionMocks.installCliPlugin).toHaveBeenCalledWith("sha256-safe-plan-digest-value"));
    expect(await within(screen.getByRole("dialog")).findByText(/已安装并保持禁用|installed and remains disabled/i)).toBeInTheDocument();
    expect(actionMocks.confirmAndEnableCliPlugin).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /确认权限并启用|Confirm permissions and enable/i }));
    await waitFor(() => expect(actionMocks.confirmAndEnableCliPlugin).toHaveBeenCalledWith("sha256-safe-plan-digest-value"));
  });

  it("blocks plan continuation and shows a safe missing CLI diagnostic", async () => {
    const user = userEvent.setup();
    const missing = { ...dependency, state: "missing" as const, commandPath: null, detectedVersion: null };
    actionMocks.listCliPlugins.mockResolvedValue({ ok: true, data: [] });
    actionMocks.listCliProviderCatalog.mockResolvedValue({ ok: true, data: [{ ...catalogItem, installed: null }] });
    actionMocks.planCatalogCliPlugin.mockResolvedValue({
      ok: false,
      error: { code: "cli_not_found", message: "private command resolution details", diagnostic: missing },
    });

    renderSection();
    await screen.findByText(plugin.displayName);
    await user.click(screen.getByRole("button", { name: /^安装$|^Install$/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /审查安装计划|Review install plan/i }));

    expect(await screen.findByText(/未找到插件 CLI 命令|CLI command was not found/i)).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText((content) => content.includes(dependency.supportedVersions))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /打开 CLI 安装文档|Open CLI installation docs/i })).toHaveAttribute("href", dependency.installDocs);
    expect(actionMocks.installCliPlugin).not.toHaveBeenCalled();
  });

  it("keeps local directory registration in a separate developer flow", async () => {
    const user = userEvent.setup();
    actionMocks.planLocalCliPlugin.mockResolvedValue({
      ok: true,
      data: { ...safePlan, source: "development" },
    });

    renderSection();
    await screen.findByText(plugin.displayName);
    await user.click(screen.getByRole("button", { name: /注册本地目录|Register local directory/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText(/npm 包名|npm package/i)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/插件目录|Plugin directory/i)).toHaveAttribute("readonly");
    await user.click(within(dialog).getByRole("button", { name: /选择目录|Choose directory/i }));
    await user.click(await screen.findByRole("button", { name: "Pick fixture directory" }));
    await user.click(within(dialog).getByRole("button", { name: /审查安装计划|Review install plan/i }));

    await waitFor(() => expect(actionMocks.planLocalCliPlugin).toHaveBeenCalledWith("/tmp/qwen-provider-dev"));
  });

  it("recovers permission review for an installed plugin after client or server state is lost", async () => {
    const user = userEvent.setup();
    actionMocks.listCliPlugins.mockResolvedValue({
      ok: true,
      data: [{ ...plugin, enabled: false, permissionConfirmed: false, health: "disabled" }],
    });
    actionMocks.listCliProviderCatalog.mockResolvedValue({
      ok: true,
      data: [{ ...catalogItem, installed: { ...plugin, enabled: false, permissionConfirmed: false, health: "disabled" } }],
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
    actionMocks.listCliPlugins.mockResolvedValue({
      ok: true,
      data: [{ ...plugin, source: "development" }],
    });
    actionMocks.listCliProviderCatalog.mockResolvedValue({ ok: true, data: [] });
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
    await user.click(await screen.findByRole("option", { name: "2" }));
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
