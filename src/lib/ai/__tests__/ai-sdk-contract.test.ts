// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  BaseCliAdapter,
  CLI_PLUGIN_API_VERSION,
  CliPluginError,
  defineCliPlugin,
  isCliPluginManifestV1,
  isCliPluginApiVersionCompatible,
  normalizePath,
  type CliHostContext,
  type CliPluginManifestV1,
  type CliQueryResult,
  type CliSessionOptions,
} from "@tower/ai-sdk";

const manifest: CliPluginManifestV1 = {
  manifestVersion: 1,
  apiVersion: CLI_PLUGIN_API_VERSION,
  kind: "cli-provider",
  display: {
    name: "Test CLI",
    description: "Test provider",
    homepage: "https://example.com/test-cli",
  },
  command: {
    default: "test-cli",
    aliases: ["test"],
    knownPaths: { darwin: ["/usr/local/bin/test-cli"] },
    versionArgs: ["--version"],
  },
  compatibility: { tower: ">=0.3.0", node: ">=20" },
  capabilities: {
    sessions: { fresh: true, resume: true, continue: true },
    query: { generate: true, stream: true },
    models: true,
    integrations: { mcp: true, hooks: true, skills: true },
  },
  permissions: ["process:spawn", "filesystem:plugin-storage"],
  configSchema: "./config.schema.json",
};

class TestAdapter extends BaseCliAdapter {
  buildSessionProcess(options: CliSessionOptions) {
    return { command: "test-cli", args: [options.mode.type, options.prompt], cwd: options.cwd };
  }

  async generate(): Promise<CliQueryResult> {
    return { text: "ok" };
  }

  async models() {
    return [{ id: "default" }];
  }
}

const host = (): CliHostContext => ({
  platform: "linux",
  arch: "x64",
  storageDir: "/tmp/plugin",
  signal: new AbortController().signal,
  process: { execute: async () => ({ exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1 }) },
  logger: { debug() {}, info() {}, warn() {}, error() {} },
});

describe("AI SDK CLI plugin contract", () => {
  it("defines a CLI-only plugin and preserves the public manifest", () => {
    const plugin = defineCliPlugin({
      manifest,
      createAdapter: (context) => new TestAdapter(context),
    });

    const processSpec = plugin.createAdapter(host(), {}).buildSessionProcess({
      prompt: "hello",
      cwd: "/work",
      mode: { type: "resume", sessionId: "session-1" },
    });
    expect(plugin.manifest.kind).toBe("cli-provider");
    expect(processSpec).toEqual({ command: "test-cli", args: ["resume", "hello"], cwd: "/work" });
    expect(processSpec).not.toHaveProperty("shell");
  });

  it("validates a static package manifest without loading plugin code", () => {
    expect(isCliPluginManifestV1(manifest)).toBe(true);
    expect(isCliPluginManifestV1({
      ...manifest,
      vendorExtension: { enabled: true },
      display: { ...manifest.display, vendorBadge: 42 },
    })).toBe(true);
    expect(isCliPluginManifestV1({
      ...manifest,
      command: { ...manifest.command, versionArgs: [""] },
    })).toBe(true);
    expect(isCliPluginManifestV1({ ...manifest, kind: "api-provider" })).toBe(false);
    expect(isCliPluginManifestV1({ ...manifest, permissions: ["database:read"] })).toBe(false);
  });

  it.each([
    ["display.description", { ...manifest, display: { ...manifest.display, description: 1 } }],
    ["display.homepage", { ...manifest, display: { ...manifest.display, homepage: 1 } }],
    ["command.aliases", { ...manifest, command: { ...manifest.command, aliases: "test" } }],
    ["command.aliases empty entry", { ...manifest, command: { ...manifest.command, aliases: [""] } }],
    ["command.knownPaths", { ...manifest, command: { ...manifest.command, knownPaths: { darwin: "/bin/test" } } }],
    ["command.knownPaths entry", { ...manifest, command: { ...manifest.command, knownPaths: { linux: [1] } } }],
    ["command.knownPaths empty entry", {
      ...manifest,
      command: { ...manifest.command, knownPaths: { darwin: [""] } },
    }],
    ["command.versionArgs", { ...manifest, command: { ...manifest.command, versionArgs: "--version" } }],
    ["compatibility.tower", { ...manifest, compatibility: { ...manifest.compatibility, tower: 1 } }],
    ["compatibility.node", { ...manifest, compatibility: { ...manifest.compatibility, node: 20 } }],
    ["sessions.resume", {
      ...manifest,
      capabilities: {
        ...manifest.capabilities,
        sessions: { ...manifest.capabilities.sessions, resume: "yes" },
      },
    }],
    ["sessions.continue", {
      ...manifest,
      capabilities: {
        ...manifest.capabilities,
        sessions: { ...manifest.capabilities.sessions, continue: 1 },
      },
    }],
    ["query.stream", {
      ...manifest,
      capabilities: {
        ...manifest.capabilities,
        query: { ...manifest.capabilities.query, stream: "yes" },
      },
    }],
    ["models", { ...manifest, capabilities: { ...manifest.capabilities, models: "yes" } }],
    ["integrations", { ...manifest, capabilities: { ...manifest.capabilities, integrations: [] } }],
    ["integrations.mcp", {
      ...manifest,
      capabilities: {
        ...manifest.capabilities,
        integrations: { ...manifest.capabilities.integrations, mcp: "yes" },
      },
    }],
    ["integrations.hooks", {
      ...manifest,
      capabilities: {
        ...manifest.capabilities,
        integrations: { ...manifest.capabilities.integrations, hooks: 1 },
      },
    }],
    ["integrations.skills", {
      ...manifest,
      capabilities: {
        ...manifest.capabilities,
        integrations: { ...manifest.capabilities.integrations, skills: null },
      },
    }],
    ["permissions container", { ...manifest, permissions: "process:spawn" }],
    ["permissions entry", { ...manifest, permissions: [1] }],
    ["configSchema", { ...manifest, configSchema: 1 }],
  ])("rejects a malformed %s field", (field, malformedManifest) => {
    expect(isCliPluginManifestV1(malformedManifest), field).toBe(false);
  });

  it("checks API major and host minor compatibility independently of manifest version", () => {
    expect(isCliPluginApiVersionCompatible("1", "1.0")).toBe(true);
    expect(isCliPluginApiVersionCompatible("1.1", "1.0")).toBe(false);
    expect(isCliPluginApiVersionCompatible("2.0", "1.9")).toBe(false);
    expect(isCliPluginApiVersionCompatible("invalid", "1.0")).toBe(false);
  });

  it("rejects invalid manifests before an adapter is created", () => {
    expect(() => defineCliPlugin({
      manifest: { ...manifest, command: { default: "" } },
      createAdapter: (context) => new TestAdapter(context),
    })).toThrowError(CliPluginError);
  });

  it("keeps cross-platform path helpers deterministic and side-effect free", () => {
    expect(normalizePath("C:/work/../bin/tool", "win32")).toBe("C:\\bin\\tool");
    expect(normalizePath("\\\\server\\share\\..\\x", "win32")).toBe("\\\\server\\share\\x");
    expect(normalizePath("C:\\root\\..\\x", "win32")).toBe("C:\\x");
    expect(normalizePath("\\foo", "win32")).toBe("\\foo");
    expect(normalizePath("..\\foo\\..\\bar", "win32")).toBe("..\\bar");
    expect(normalizePath("/opt/work/../bin/tool", "linux")).toBe("/opt/bin/tool");
  });
});
