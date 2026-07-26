// @vitest-environment node
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { processState, mockAdapter } = vi.hoisted(() => {
  const processState = {
    stdout: "",
    stderr: "",
    exitCode: 0 as number | null,
    spawnArgs: [] as string[][],
  };

  const mockAdapter = {
    buildHelloProbe: vi.fn(({ prompt }: { prompt: string }) => ({
      command: "/usr/local/bin/codex",
      args: ["exec", prompt],
      cwd: "/project",
    })),
  };

  return { processState, mockAdapter };
});

vi.mock("@/lib/platform", () => ({
  resolveCommandPath: vi.fn(async () => "/usr/local/bin/codex"),
  resolveSpawnTarget: vi.fn(async (command: string, args: string[]) => ({ command, args })),
  ensurePathInEnv: vi.fn((env: NodeJS.ProcessEnv) => env),
  stripClaudeNestingEnv: vi.fn((env: NodeJS.ProcessEnv) => env),
}));

vi.mock("@/lib/ai/providers", () => ({
  providerRegistry: {
    get: vi.fn((name: string) =>
      name === "codex"
        ? {
            name: "codex",
            displayName: "Codex CLI",
            agentFieldValue: "CODEX_CLI",
            cli: {
              command: "codex",
              plugin: {
                manifest: {
                  command: { default: "codex", aliases: [], versionArgs: ["--version"] },
                  cliDependency: {
                    name: "Codex CLI",
                    supportedVersions: ">=0.1.0",
                    homepage: "https://example.com",
                    installDocs: "https://example.com/install",
                    managedByTower: false,
                  },
                },
              },
              adapter: mockAdapter,
            },
            models: { cli: [], api: [] },
          }
        : undefined,
    ),
  },
}));

vi.mock("@/lib/ai/provider-host", () => ({
  providerBaseEnvironment: vi.fn(() => ({ PATH: "/usr/local/bin" })),
  resolveBuiltInCommandResolution: vi.fn(async () => ({
    selected: {
      state: "runnable",
      path: "/usr/local/bin/codex",
      version: "codex-cli 0.145.0",
    },
    candidates: [],
  })),
  createBuiltInAdapter: vi.fn(() => mockAdapter),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();

  return {
    ...original,
    spawn: vi.fn((_command: string, args: string[]) => {
      processState.spawnArgs.push(args);

      const child = new EventEmitter() as ChildProcess & {
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
        killed: boolean;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.killed = false;
      child.kill = vi.fn(() => {
        child.killed = true;
        return true;
      });

      queueMicrotask(() => {
        if (processState.stdout) child.stdout.emit("data", Buffer.from(processState.stdout));
        if (processState.stderr) child.stderr.emit("data", Buffer.from(processState.stderr));
        child.emit("close", processState.exitCode, null);
      });

      return child;
    }),
  };
});

describe("testEnvironment generic CLI probe", () => {
  beforeEach(() => {
    processState.stdout = "";
    processState.stderr = "";
    processState.exitCode = 0;
    processState.spawnArgs = [];
    mockAdapter.buildHelloProbe.mockClear();
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => delete process.env.OPENAI_API_KEY);

  it("does not select a default provider when the requested provider is unknown", async () => {
    const { testEnvironment } = await import("@/lib/cli-test");
    const result = await testEnvironment("/project", "community-fixture");

    expect(result).toEqual({
      ok: false,
      checks: [{
        name: "community-fixture_provider",
        passed: false,
        message: "CLI provider is not registered",
      }],
    });
    expect(mockAdapter.buildHelloProbe).not.toHaveBeenCalled();
  });

  it("accepts successful Codex probes that return plain stdout", async () => {
    processState.stdout = "hello\n";

    const { testEnvironment } = await import("@/lib/cli-test");
    const result = await testEnvironment("/project", "codex");

    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual({
      name: "codex_hello_probe",
      passed: true,
      message: "codex hello probe succeeded (model replied: hello)",
    });
    expect(result.checks).toContainEqual({
      name: "codex_cli_auth",
      passed: true,
      message: "Authentication is managed by codex",
    });
  });

  it("still fails successful probes with no usable output", async () => {
    const { testEnvironment } = await import("@/lib/cli-test");
    const result = await testEnvironment("/project", "codex");

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      name: "codex_hello_probe",
      passed: false,
      message: "codex probe ran but produced no usable response text",
    });
  });

  it("redacts home paths and credential values from probe failures", async () => {
    processState.exitCode = 1;
    process.env.OPENAI_API_KEY = "test-secret-value";
    processState.stderr = `failure under ${homedir()}: test-secret-value`;

    const { testEnvironment } = await import("@/lib/cli-test");
    const result = await testEnvironment("/project", "codex");
    const check = result.checks.find((item) => item.name === "codex_hello_probe");

    expect(check?.message).toContain("failure under ~: [redacted]");
    expect(check?.message).not.toContain(homedir());
    expect(check?.message).not.toContain("test-secret-value");
  });
});
