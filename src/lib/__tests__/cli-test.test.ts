// @vitest-environment node
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { processState, mockAdapter } = vi.hoisted(() => {
  const processState = {
    stdout: "",
    stderr: "",
    exitCode: 0 as number | null,
    spawnArgs: [] as string[][],
  };

  const mockAdapter = {
    getVersion: vi.fn(async () => "codex-cli 0.145.0"),
    getApiKeyInfo: vi.fn(() => ({ envVar: "OPENAI_API_KEY", required: false })),
    buildHelloProbeArgs: vi.fn((prompt: string) => ({
      command: "codex",
      args: ["exec", prompt],
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
              adapter: mockAdapter,
            },
            models: { cli: [], api: [] },
          }
        : undefined,
    ),
  },
}));

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();

  return {
    ...original,
    spawn: vi.fn((_command: string, args: string[]) => {
      processState.spawnArgs.push(args);

      const child = new EventEmitter() as ChildProcess & {
        stdout: PassThrough;
        stderr: PassThrough;
        killed: boolean;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.killed = false;
      child.kill = vi.fn(() => {
        child.killed = true;
        return true;
      });

      queueMicrotask(() => {
        if (processState.stdout) child.stdout.emit("data", processState.stdout);
        if (processState.stderr) child.stderr.emit("data", processState.stderr);
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
    mockAdapter.getVersion.mockClear();
    mockAdapter.getApiKeyInfo.mockClear();
    mockAdapter.buildHelloProbeArgs.mockClear();
    delete process.env.OPENAI_API_KEY;
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
      name: "codex_api_key",
      passed: false,
      message: "OPENAI_API_KEY is not set (codex may use subscription auth)",
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
});
