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

import { ProviderRegistry } from "../provider-registry";
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
        },
      }),
    ]);
  });

  it("lists enabled plugin manifests without loading third-party adapter code", async () => {
    dynamicMocks.listPlugins.mockResolvedValue([{
      id: "@acme/community",
      displayName: "Community",
      enabled: true,
      permissionConfirmed: true,
      health: "ready",
    }]);
    dynamicMocks.findMany.mockResolvedValue([{
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
      }),
    })]);
    expect(dynamicMocks.resolvePlugin).not.toHaveBeenCalled();
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
