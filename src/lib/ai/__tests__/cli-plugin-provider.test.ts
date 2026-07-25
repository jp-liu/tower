// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  runtimeGet: vi.fn(),
  runtimeInspect: vi.fn(),
  runtimeLoad: vi.fn(),
  createHost: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@tower/ai-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tower/ai-runtime")>();
  return {
    ...actual,
    CommandResolver: class {
      resolve = mocks.resolve;
    },
  };
});
vi.mock("../cli-plugin-service", () => ({
  CliPluginApplicationError: class CliPluginApplicationError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  getCliPluginApplication: () => ({
    runtime: {
      get: mocks.runtimeGet,
      inspect: mocks.runtimeInspect,
      load: mocks.runtimeLoad,
    },
  }),
}));
vi.mock("../provider-host", () => ({
  providerBaseEnvironment: () => ({ PATH: "/fixture/bin" }),
  createProviderHostContext: mocks.createHost,
  mergeProviderProcess: (
    spec: { command: string; args: string[]; envPatch?: Record<string, string> },
    command: string,
    profile: { baseArgs?: string[]; envPatch?: Record<string, string> },
  ) => ({
    ...spec,
    command,
    args: [...(profile.baseArgs ?? []), ...spec.args],
    envPatch: { ...(profile.envPatch ?? {}), ...(spec.envPatch ?? {}) },
  }),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/tower-dir", () => ({ getTowerDir: () => "/tmp/tower-fixture" }));

import { resolvePluginCliConnection } from "../cli-plugin-provider";

const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema" as const,
  type: "object" as const,
  properties: {
    profile: { type: "string" as const, default: "safe" },
  },
  additionalProperties: false,
};

describe("dynamic CLI plugin connection resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtimeGet.mockResolvedValue({
      id: "@acme/community-cli",
      enabled: true,
      permissions: ["process:spawn", "filesystem:provider-config"],
    });
    mocks.runtimeInspect.mockResolvedValue({
      manifest: {
        display: { name: "Community CLI" },
        command: {
          default: "community",
          aliases: ["community-cli"],
          knownPaths: { darwin: ["/opt/community"] },
          versionArgs: ["version"],
        },
        capabilities: { sessions: { fresh: true }, query: { generate: true }, models: true },
      },
      configSchema,
    });
    mocks.createHost.mockReturnValue({ resources: {}, process: {}, signal: new AbortController().signal });
    mocks.runtimeLoad.mockResolvedValue({
      buildSessionProcess: () => ({
        command: "community",
        args: ["--plugin-arg"],
        envPatch: { PLUGIN_MODE: "safe" },
      }),
      generate: vi.fn(async () => ({ text: "ok" })),
      models: vi.fn(async () => [{ id: "community-model" }]),
    });
    mocks.resolve.mockResolvedValue({
      state: "runnable",
      selected: { path: "/custom/community", state: "runnable", version: "1.2.3" },
      candidates: [],
    });
  });

  it("uses the shared command policy and merges Tower-owned connection settings", async () => {
    const signal = new AbortController().signal;
    const resolved = await resolvePluginCliConnection({
      id: "connection-1",
      provider: "@acme/community-cli",
      enabled: true,
      commandOverride: "/custom/community",
      baseArgsJson: JSON.stringify(["--tower-arg"]),
      envVarsJson: JSON.stringify([
        { id: "token", name: "COMMUNITY_TOKEN", value: "canary", enabled: true, sensitive: true },
      ]),
      settingsJson: "{}",
    }, "/workspace", { signal });

    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({
      commandOverride: "/custom/community",
      defaultCommand: "community",
      aliases: ["community-cli"],
      knownPaths: ["/opt/community"],
      versionArgs: ["version"],
      signal,
    }));
    expect(mocks.runtimeLoad).toHaveBeenCalledWith(
      "@acme/community-cli",
      expect.anything(),
      { profile: "safe" },
    );
    expect(mocks.createHost).toHaveBeenCalledWith(
      "@acme/community-cli",
      "/custom/community",
      signal,
      expect.objectContaining({
        baseArgs: ["--tower-arg"],
        envOverrides: { COMMUNITY_TOKEN: "canary" },
        providerConfigDir: expect.stringContaining(".community"),
        storageDir: expect.stringContaining("plugin-storage"),
      }),
    );
    expect(resolved.adapter.buildSessionProcess({ cwd: "/workspace", prompt: "hello", mode: { type: "fresh" } }))
      .toMatchObject({
        command: "/custom/community",
        args: ["--tower-arg", "--plugin-arg"],
        envPatch: { COMMUNITY_TOKEN: "canary", PLUGIN_MODE: "safe" },
      });
    expect(resolved.provider).toMatchObject({
      name: "@acme/community-cli",
      displayName: "Community CLI",
      builtin: false,
    });
  });

  it("omits the provider config directory without its declared permission", async () => {
    mocks.runtimeGet.mockResolvedValue({
      id: "@acme/community-cli",
      enabled: true,
      permissions: ["process:spawn"],
    });

    await resolvePluginCliConnection({
      id: "connection-1",
      provider: "@acme/community-cli",
      enabled: true,
      commandOverride: null,
      baseArgsJson: "[]",
      envVarsJson: "[]",
      settingsJson: "{}",
    }, "/workspace");

    expect(mocks.createHost).toHaveBeenCalledWith(
      "@acme/community-cli",
      "/custom/community",
      expect.any(AbortSignal),
      expect.objectContaining({ providerConfigDir: null }),
    );
  });
});
