import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CliAdapter, CliPlugin } from "@tower/ai-sdk";

const hostMocks = vi.hoisted(() => ({
  createBuiltInAdapter: vi.fn(() => ({})),
  resolveBuiltInCommandResolution: vi.fn(),
}));
const dynamicMocks = vi.hoisted(() => ({
  listPlugins: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
  findMany: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
  findUnique: vi.fn(),
  resolvePlugin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../provider-host", () => hostMocks);
vi.mock("@/lib/db", () => ({
  db: { providerConnection: { findMany: dynamicMocks.findMany, findUnique: dynamicMocks.findUnique } },
}));
vi.mock("../cli-plugin-service", () => ({
  getCliPluginApplication: () => ({ list: dynamicMocks.listPlugins }),
}));
vi.mock("../cli-plugin-provider", () => ({ resolvePluginCliConnection: dynamicMocks.resolvePlugin }));

import { getRegisteredProviderAvailability, ProviderRegistry } from "../provider-registry";
import type { ProviderDefinition } from "../types";

function makeClaudeProvider(): ProviderDefinition {
  return {
    name: "claude",
    displayName: "Claude Code",
    agentFieldValue: "CLAUDE_CODE",
    builtin: true,
    cli: {
      command: "claude",
      adapter: {} as CliAdapter,
      plugin: {
        manifest: {
          display: { name: "Claude Code" },
          command: { default: "claude" },
          cliDependency: {
            name: "Claude Code CLI",
            homepage: "https://example.invalid/claude",
            installDocs: "https://example.invalid/claude/install",
            supportedVersions: ">=1.0.0",
            managedByTower: false,
          },
          capabilities: { integrations: { mcp: true, hooks: true, skills: true } },
          permissions: ["integration:mcp", "integration:hooks", "integration:skills"],
        },
      } as CliPlugin,
    },
    models: { cli: [], api: [] },
  };
}

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    dynamicMocks.listPlugins.mockResolvedValue([]);
    dynamicMocks.findMany.mockResolvedValue([]);
    registry = new ProviderRegistry();
  });

  it("registers and retrieves a provider", () => {
    registry.register(makeClaudeProvider());
    const provider = registry.get("claude");
    expect(provider).toBeDefined();
    expect(provider!.displayName).toBe("Claude Code");
  });

  it("returns undefined for unknown provider", () => {
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("returns CLI adapter for registered provider", () => {
    registry.register(makeClaudeProvider());
    const adapter = registry.getCliAdapter("claude");
    expect(adapter).toBeDefined();
  });

  it("returns null CLI adapter for provider without CLI", () => {
    registry.register({
      ...makeClaudeProvider(),
      name: "api-only",
      cli: undefined,
    });
    expect(registry.getCliAdapter("api-only")).toBeNull();
  });

  it("returns all allowed commands from registered CLI providers", () => {
    registry.register(makeClaudeProvider());
    expect(registry.getAllowedCommands()).toContain("claude");
  });

  it("lists all providers", () => {
    registry.register(makeClaudeProvider());
    expect(registry.getAll()).toHaveLength(1);
  });

  it("builds a registered snapshot from definitions without a registry instance method", () => {
    expect(getRegisteredProviderAvailability([makeClaudeProvider()])).toEqual([
      expect.objectContaining({
        name: "claude",
        builtin: true,
        cli: expect.objectContaining({
          available: false,
          integrations: { mcp: true, hooks: true, skills: true },
          connectionStatus: "untested",
        }),
      }),
    ]);
  });

  it("returns null query adapter for unregistered provider", () => {
    expect(registry.getQueryAdapter("nonexistent", "api")).toBeNull();
  });

  it("returns null query adapter when mode not supported", () => {
    registry.register(makeClaudeProvider());
    // Claude provider has no api adapter registered yet
    expect(registry.getQueryAdapter("claude", "api")).toBeNull();
  });

  it("reports builtin identity and resolved CLI command details", async () => {
    hostMocks.resolveBuiltInCommandResolution
      .mockResolvedValueOnce({
        state: "runnable",
        selected: { state: "runnable", path: "/opt/tower/bin/claude", version: "2.4.1" },
      })
      .mockResolvedValueOnce({
        state: "found",
        selected: { state: "found", path: "/opt/extensions/acme", version: null },
      });
    registry.register(makeClaudeProvider());
    registry.register({
      ...makeClaudeProvider(),
      name: "acme",
      displayName: "Acme CLI",
      agentFieldValue: "ACME_CLI",
      builtin: false,
    });

    const providers = await registry.getAvailableProviders();

    expect(providers).toEqual([
      expect.objectContaining({
        name: "claude",
        builtin: true,
        cli: {
          available: true,
          version: "2.4.1",
          commandPath: "/opt/tower/bin/claude",
          commandState: "runnable",
          integrations: { mcp: true, hooks: true, skills: true },
        },
      }),
      expect.objectContaining({
        name: "acme",
        builtin: false,
        cli: {
          available: false,
          version: null,
          commandPath: "/opt/extensions/acme",
          commandState: "found",
          connectionStatus: "dependencyMissing",
          integrations: { mcp: true, hooks: true, skills: true },
        },
      }),
    ]);
  });

  it("lists enabled plugin manifests without loading third-party adapter code", async () => {
    dynamicMocks.listPlugins.mockResolvedValue([{
      id: "@acme/community",
      displayName: "Community",
      version: "1.2.3",
      enabled: true,
      permissionConfirmed: true,
      health: "ready",
      capabilities: { integrations: {} },
    }]);
    dynamicMocks.findMany.mockResolvedValue([{
      id: "community-connection",
      name: "Community",
      provider: "@acme/community",
      enabled: true,
      testOk: true,
      resolvedCommand: "/opt/community",
      resolvedVersion: "1.2.3",
      testStatus: "connected",
    }]);

    const providers = await registry.getAvailableProviders();

    expect(providers).toEqual([expect.objectContaining({
      name: "@acme/community",
      displayName: "Community",
      builtin: false,
      cli: expect.objectContaining({
        available: true,
        commandPath: "/opt/community",
        connectionStatus: "connected",
        integrations: { mcp: false, hooks: false, skills: false },
      }),
    })]);
    expect(dynamicMocks.resolvePlugin).not.toHaveBeenCalled();
  });

  it("enumerates built-in and only eligible dynamic CLI providers without loading adapters", async () => {
    registry.register(makeClaudeProvider());
    dynamicMocks.listPlugins.mockResolvedValue([
      {
        id: "@acme/ready",
        displayName: "Ready CLI",
        version: "2.0.0",
        enabled: true,
        permissionConfirmed: true,
        health: "ready",
        capabilities: { integrations: { mcp: true } },
      },
      {
        id: "@acme/pending",
        displayName: "Pending CLI",
        version: "2.0.0",
        enabled: true,
        permissionConfirmed: false,
        health: "ready",
        capabilities: { integrations: { mcp: true } },
      },
    ]);
    dynamicMocks.findMany.mockResolvedValue([
      { id: "ready-connection", provider: "@acme/ready", enabled: true },
      { id: "pending-connection", provider: "@acme/pending", enabled: true },
    ]);

    await expect(registry.listCliProviders()).resolves.toEqual([
      expect.objectContaining({ id: "claude", builtin: true }),
      expect.objectContaining({
        id: "@acme/ready",
        builtin: false,
        providerVersion: "2.0.0",
        connectionId: "ready-connection",
      }),
    ]);
    expect(dynamicMocks.resolvePlugin).not.toHaveBeenCalled();
  });

  it("resolves the exact selected community connection record", async () => {
    const connection = {
      id: "selected-connection",
      provider: "@acme/community",
      enabled: true,
      commandOverride: "/opt/selected-community",
      baseArgsJson: "[]",
      envVarsJson: "[]",
      settingsJson: "{}",
    };
    dynamicMocks.resolvePlugin.mockResolvedValue({
      adapter: {},
      commandPath: connection.commandOverride,
      version: "1",
    });

    await registry.createResolvedCliConnectionAdapter(connection, "/worktree");

    expect(dynamicMocks.resolvePlugin).toHaveBeenCalledWith(connection, "/worktree");
    expect(dynamicMocks.findUnique).not.toHaveBeenCalled();
  });

  it("reports only integrations declared by a partial provider manifest", async () => {
    hostMocks.resolveBuiltInCommandResolution.mockResolvedValue({
      state: "runnable",
      selected: { state: "runnable", path: "/opt/gemini", version: "1.0.0" },
    });
    const provider = makeClaudeProvider();
    registry.register({
      ...provider,
      name: "gemini",
      displayName: "Gemini CLI",
      cli: {
        ...provider.cli!,
        plugin: {
          manifest: {
            ...provider.cli!.plugin.manifest,
            capabilities: { integrations: { mcp: true, hooks: false, skills: true } },
            permissions: ["integration:mcp", "integration:skills"],
          },
        } as CliPlugin,
      },
    });

    expect((await registry.getAvailableProviders())[0]?.cli.integrations).toEqual({
      mcp: true,
      hooks: false,
      skills: true,
    });
  });

  it("marks a runnable built-in CLI unavailable when its detected version is incompatible", async () => {
    hostMocks.resolveBuiltInCommandResolution.mockResolvedValue({
      state: "runnable",
      selected: { state: "runnable", path: "/opt/claude", version: "0.0.1" },
    });
    registry.register(makeClaudeProvider());

    await expect(registry.getAvailableProviders()).resolves.toEqual([
      expect.objectContaining({
        name: "claude",
        cli: expect.objectContaining({
          available: false,
          connectionStatus: "dependencyIncompatible",
        }),
      }),
    ]);
  });

  it("reports installed plugin lifecycle states without treating them as missing commands", async () => {
    dynamicMocks.listPlugins.mockResolvedValue([
      { id: "@acme/pending", displayName: "Pending", enabled: false, permissionConfirmed: false, health: "disabled" },
      { id: "@acme/disabled", displayName: "Disabled", enabled: false, permissionConfirmed: true, health: "disabled" },
      { id: "@acme/damaged", displayName: "Damaged", enabled: false, permissionConfirmed: false, health: "corrupt" },
      { id: "@acme/untested", displayName: "Untested", enabled: true, permissionConfirmed: true, health: "ready" },
    ]);
    dynamicMocks.findMany.mockResolvedValue([
      { name: "Pending", provider: "@acme/pending", enabled: false, testOk: false, resolvedCommand: null, resolvedVersion: null, testStatus: "unavailable" },
      { name: "Disabled", provider: "@acme/disabled", enabled: false, testOk: false, resolvedCommand: "/opt/disabled", resolvedVersion: "1", testStatus: "unavailable" },
      { name: "Damaged", provider: "@acme/damaged", enabled: false, testOk: false, resolvedCommand: null, resolvedVersion: null, testStatus: "unavailable" },
      { name: "Untested", provider: "@acme/untested", enabled: true, testOk: false, resolvedCommand: null, resolvedVersion: null, testStatus: "untested" },
      { name: "Removed", provider: "@acme/removed", enabled: false, testOk: false, resolvedCommand: "/opt/removed", resolvedVersion: "1", testStatus: "unavailable" },
    ]);

    const states = new Map((await registry.getAvailableProviders()).map((provider) => [
      provider.name,
      provider.cli.connectionStatus,
    ]));
    expect(states).toEqual(new Map([
      ["@acme/pending", "permissionRequired"],
      ["@acme/disabled", "pluginDisabled"],
      ["@acme/damaged", "pluginDamaged"],
      ["@acme/untested", "untested"],
      ["@acme/removed", "pluginUninstalled"],
    ]));
  });
});
