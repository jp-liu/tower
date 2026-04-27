import { describe, it, expect, beforeEach } from "vitest";
import { ProviderRegistry } from "../provider-registry";
import type { ProviderDefinition } from "../types";
import { ClaudeCliAdapter } from "../adapters/cli/claude-cli-adapter";

function makeClaudeProvider(): ProviderDefinition {
  return {
    name: "claude",
    displayName: "Claude Code",
    agentFieldValue: "CLAUDE_CODE",
    cli: {
      command: "claude",
      adapter: new ClaudeCliAdapter(),
    },
    models: {
      cli: ["sonnet", "opus", "haiku"],
      api: [],
    },
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
});
