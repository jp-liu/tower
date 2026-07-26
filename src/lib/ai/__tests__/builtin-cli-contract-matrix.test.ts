// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CommandResolver } from "@tower-org/ai-runtime";
import {
  CliPluginError,
  type CliAdapter,
  type CliHostContext,
  type CliPluginManifestV1,
  type CliProcessExecutor,
} from "@tower-org/ai-sdk";
import { ClaudeCliAdapter, claudeManifest } from "@tower-org/ai-provider-claude";
import { CodexCliAdapter, codexManifest } from "@tower-org/ai-provider-codex";
import { GeminiCliAdapter, geminiManifest } from "@tower-org/ai-provider-gemini";

type ProviderCase = {
  id: string;
  manifest: CliPluginManifestV1;
  create(host: CliHostContext): CliAdapter;
};

const providers: ProviderCase[] = [
  { id: "claude", manifest: claudeManifest, create: (host) => new ClaudeCliAdapter(host) },
  { id: "codex", manifest: codexManifest, create: (host) => new CodexCliAdapter(host) },
  { id: "gemini", manifest: geminiManifest, create: (host) => new GeminiCliAdapter(host) },
];

function host(id: string, stream?: CliProcessExecutor["stream"]): CliHostContext {
  return {
    platform: "linux",
    arch: "x64",
    storageDir: `/tmp/tower-contract-${id}`,
    signal: new AbortController().signal,
    process: {
      execute: vi.fn(async () => ({ exitCode: 0, signal: null, stdout: "[]", stderr: "", durationMs: 1 })),
      stream: stream ?? (async function* () {
        yield { type: "exit" as const, exitCode: 0, signal: null, durationMs: 1 };
      }),
      probeMcpServer: vi.fn(async () => false),
    },
    fileSystem: {
      exists: () => false,
      mkdir() {},
      readText: () => "",
      writeText() {},
      lstat: async () => null,
      readLink: async () => "",
      symlink: async () => {},
      unlink: async () => {},
    },
    resources: {
      homeDir: "/tmp/tower-contract-home",
      providerConfigDir: `/tmp/tower-contract-home/.${id}`,
      commandPath: `/fake/bin/${id}`,
      towerPackageRoot: "/opt/tower",
      managedConfigPaths: [],
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
}

async function resolveState(
  provider: ProviderCase,
  state: "not-found" | "found" | "runnable" | "connected",
) {
  const commandPath = `/fake/bin/${provider.id}`;
  const executable = state === "runnable" || state === "connected";
  const executor: CliProcessExecutor = {
    execute: vi.fn(async () => ({ exitCode: 0, signal: null, stdout: `${provider.id} 1.0`, stderr: "", durationMs: 1 })),
  };
  const resolver = new CommandResolver({
    platform: "linux",
    env: { PATH: "/fake/bin", HOME: "/tmp/tower-contract-home" },
    homeDir: "/tmp/tower-contract-home",
    fileSystem: {
      exists: async (candidate) => state !== "not-found" && candidate === commandPath,
      executable: async (candidate) => executable && candidate === commandPath,
    },
    executor,
  });
  const adapter = provider.create(host(provider.id));
  return resolver.resolve({
    commandOverride: commandPath,
    defaultCommand: provider.manifest.command.default,
    versionArgs: provider.manifest.command.versionArgs,
    cwd: "/work",
    ...(state === "connected"
      ? { helloProbe: (candidate) => adapter.buildHelloProbe!({ command: candidate.path, cwd: "/work", prompt: "hello" }) }
      : {}),
  });
}

describe.each(providers)("$id built-in CLI contract", (provider) => {
  it("proves not-found, found, runnable, and connected command states with its own Hello probe", async () => {
    for (const state of ["not-found", "found", "runnable", "connected"] as const) {
      const resolution = await resolveState(provider, state);
      expect(resolution.state).toBe(state);
      if (state === "connected") expect(resolution.selected?.version).toBe(`${provider.id} 1.0`);
    }
  });

  it("supports explicit model session plans, a model result array, and cancellation", async () => {
    const cancelled = async function* () {
      throw new CliPluginError("PROCESS_CANCELLED", "Cancelled by contract test");
      yield { type: "exit" as const, exitCode: null, signal: "SIGTERM", durationMs: 1 };
    };
    const adapter = provider.create(host(provider.id, cancelled));
    const session = adapter.buildSessionProcess({
      prompt: "model contract", cwd: "/work", mode: { type: "fresh" }, model: "contract-model",
    });
    expect(JSON.stringify({ args: session.args, initialInput: session.initialInput }))
      .toContain("contract-model");
    await expect(adapter.models()).resolves.toEqual(expect.any(Array));
    await expect(adapter.generate({ prompt: "cancel contract", model: "contract-model" }))
      .rejects.toMatchObject({ code: "PROCESS_CANCELLED" });
  });
});
