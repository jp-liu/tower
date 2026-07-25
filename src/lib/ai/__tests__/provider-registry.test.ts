import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CliAdapter, CliPlugin } from "@tower/ai-sdk";

const hostMocks = vi.hoisted(() => ({
  createBuiltInAdapter: vi.fn(() => ({})),
  resolveBuiltInCommandResolution: vi.fn(),
}));

vi.mock("../provider-host", () => hostMocks);

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
});
