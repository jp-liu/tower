// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const fsMocks = vi.hoisted(() => ({
  mkdtemp: vi.fn(async () => "/tmp/tower-pty-unit-test"),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => "selected instructions"),
  rm: vi.fn(async () => {}),
}));

vi.mock("fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("fs/promises")>(),
  ...fsMocks,
}));
vi.mock("server-only", () => ({}));

// Drives the real startPtyExecution with the PTY spawn stubbed out, so the
// assertions read the actual --append-system-prompt the CLI would receive.

vi.mock("@/lib/db", () => ({
  db: {
    task: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    taskMessage: { findMany: vi.fn(async () => []) },
    agentPrompt: { findUnique: vi.fn() },
    taskExecution: {
      count: vi.fn(async () => 0),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({ id: "exec1" })),
      update: vi.fn(async () => ({ id: "exec1" })),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    aiCapabilityAttempt: { create: vi.fn(async () => ({})) },
    cliProfile: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/pty/session-store", () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/harness/harness-message", () => ({ cancelOpenAsks: vi.fn(async () => {}) }));
vi.mock("@/lib/worktree", () => ({ createWorktree: vi.fn() }));
// No SystemConfig override in this test → readConfigValue returns the passed default,
// which is exactly what CONFIG_DEFAULTS carries.
vi.mock("@/lib/config-reader", () => ({
  readConfigValue: vi.fn(async (_key: string, fallback: unknown) => fallback),
}));
vi.mock("@/lib/ai/capability-resolver", () => ({
  resolveTerminalTargetPlan: vi.fn(),
  resolveFixedCliConnection: vi.fn(),
  resolveLegacyExecutionCliConnection: vi.fn(),
}));
vi.mock("@/lib/ai/providers", () => ({
  providerRegistry: {
    get: vi.fn(),
    getByAgentFieldValue: vi.fn(),
    createResolvedCliAdapter: vi.fn(async () => ({
      commandPath: "claude",
      adapter: {
        buildSessionProcess: ({ cwd, envPatch, systemPrompt }: {
          cwd: string;
          envPatch?: Record<string, string>;
          systemPrompt?: string;
        }) => ({
          command: "claude",
          args: systemPrompt ? ["--append-system-prompt", systemPrompt] : [],
          cwd,
          envPatch,
        }),
      },
    })),
  },
}));

import { db } from "@/lib/db";
import { createSession } from "@/lib/pty/session-store";
import {
  resolveFixedCliConnection,
  resolveLegacyExecutionCliConnection,
  resolveTerminalTargetPlan,
} from "@/lib/ai/capability-resolver";
import { providerRegistry } from "@/lib/ai/providers";
import { createWorktree } from "@/lib/worktree";
import {
  continueLatestPtyExecution,
  resumePtyExecution,
  startPtyExecution,
} from "@/actions/agent-actions";

const mockDb = db as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  agentPrompt: { findUnique: ReturnType<typeof vi.fn> };
  taskExecution: {
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  cliProfile: { findFirst: ReturnType<typeof vi.fn> };
};

type TaskLabel = { label: { name: string; isBuiltin: boolean } };

function taskWithLabels(labels: TaskLabel[]) {
  return {
    id: "t1",
    title: "T",
    description: null,
    status: "TODO",
    promptId: null,
    baseBranch: null,
    subPath: null,
    project: { id: "p1", localPath: process.cwd(), workspaceId: "w1" },
    labels,
  };
}

function cliProvider(name: "claude" | "codex" | "gemini") {
  const commands = {
    claude: { default: "claude", aliases: ["claude-code"], agent: "CLAUDE_CODE" },
    codex: { default: "codex", aliases: ["codex-cli"], agent: "CODEX_CLI" },
    gemini: { default: "gemini", aliases: ["gemini-cli"], agent: "GEMINI_CLI" },
  }[name];
  return {
    name,
    agentFieldValue: commands.agent,
    builtin: true,
    cli: { plugin: { manifest: { command: commands } } },
  };
}

function terminalTarget(
  providerName: "claude" | "codex" | "gemini" = "claude",
  overrides: Record<string, unknown> = {},
) {
  const provider = cliProvider(providerName);
  return {
    targetId: `target-${providerName}`,
    connectionId: `connection-${providerName}`,
    modelId: `${providerName}-model`,
    order: 0,
    kind: "cli" as const,
    provider: providerName,
    connectionName: providerName,
    cli: {
      provider,
      commandPath: providerName,
      adapter: {
        buildSessionProcess: ({ cwd, envPatch, systemPrompt }: {
          cwd: string;
          envPatch?: Record<string, string | null>;
          systemPrompt?: string;
        }) => ({
          command: providerName,
          args: systemPrompt ? ["--append-system-prompt", systemPrompt] : ["--provider-args"],
          cwd,
          envPatch,
        }),
      },
    },
    ...overrides,
  };
}

/** The --append-system-prompt value handed to the spawned CLI. */
function injectedDirective(): string {
  const args = vi.mocked(createSession).mock.calls[0][2] as string[];
  return args[args.indexOf("--append-system-prompt") + 1];
}

describe("startPtyExecution directive selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.taskExecution.create.mockResolvedValue({ id: "exec1" });
    mockDb.cliProfile.findFirst.mockResolvedValue(null);
    vi.mocked(resolveTerminalTargetPlan).mockResolvedValue({
      slot: "terminal",
      targets: [terminalTarget()],
      migrationStatus: "complete",
    } as never);
    vi.mocked(providerRegistry.createResolvedCliAdapter).mockImplementation(async (name) => ({
      commandPath: name,
      version: null,
      adapter: {
        buildSessionProcess: ({ cwd, envPatch, systemPrompt }: {
          cwd: string;
          envPatch?: Record<string, string | null>;
          systemPrompt?: string;
        }) => ({
          command: name,
          args: systemPrompt ? ["--append-system-prompt", systemPrompt] : ["--provider-args"],
          cwd,
          envPatch,
        }),
      },
    } as never));
  });

  it("injects the workbench directive for a task with the builtin Tower label", async () => {
    mockDb.task.findUnique.mockResolvedValue(
      taskWithLabels([{ label: { name: "Tower", isBuiltin: true } }])
    );

    await startPtyExecution("t1", "");

    const directive = injectedDirective();
    expect(directive).toContain("## Tower Workbench");
    expect(directive).not.toContain("## About Tower");
    // The workbench lives in the main worktree and has no Complete button.
    expect(directive).not.toContain("Worktree discipline");
    expect(directive).not.toContain("Commit echo for this turn");
  });

  it("injects the normal task directive for a task without the Tower label", async () => {
    mockDb.task.findUnique.mockResolvedValue(
      taskWithLabels([{ label: { name: "bug", isBuiltin: false } }])
    );

    await startPtyExecution("t1", "");

    const directive = injectedDirective();
    expect(directive).toContain("## About Tower");
    expect(directive).toContain("Worktree discipline");
    expect(directive).not.toContain("## Tower Workbench");
  });

  it("ignores a non-builtin label that merely happens to be named Tower", async () => {
    mockDb.task.findUnique.mockResolvedValue(
      taskWithLabels([{ label: { name: "Tower", isBuiltin: false } }])
    );

    await startPtyExecution("t1", "");

    expect(injectedDirective()).toContain("## About Tower");
  });

  it("marks the execution failed when the PTY cannot be started", async () => {
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));
    vi.mocked(createSession).mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });

    await expect(startPtyExecution("t1", "")).rejects.toThrow("could not be started");
    expect(mockDb.taskExecution.updateMany).toHaveBeenCalledWith({
      where: { id: "exec1", status: { in: ["PENDING", "RUNNING"] } },
      data: {
        status: "FAILED",
        endedAt: expect.any(Date),
        connectionId: null,
        modelId: null,
        targetId: null,
      },
    });
  });

  it.each(["codex", "gemini"] as const)(
    "does not apply a default Claude profile when %s is selected",
    async (providerName) => {
      mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));
      mockDb.cliProfile.findFirst.mockResolvedValue({
        command: "claude",
        baseArgs: JSON.stringify(["--legacy-claude"]),
        envVars: JSON.stringify({ PROFILE_ONLY: "claude" }),
      });
      vi.mocked(resolveTerminalTargetPlan).mockResolvedValue({
        slot: "terminal",
        targets: [terminalTarget(providerName)],
        migrationStatus: "complete",
      } as never);

      await startPtyExecution("t1", "");

      expect(vi.mocked(createSession).mock.calls[0][1]).toBe(providerName);
      expect(vi.mocked(createSession).mock.calls[0][2]).not.toContain("--legacy-claude");
      expect(vi.mocked(createSession).mock.calls[0][6]).not.toHaveProperty("PROFILE_ONLY");
    },
  );

  it("merges a matching profile before Provider args and lets task env win", async () => {
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));
    mockDb.cliProfile.findFirst.mockResolvedValue({
      command: "/custom/bin/claude.cmd",
      baseArgs: JSON.stringify(["--legacy-profile"]),
      envVars: JSON.stringify({ TOWER_TASK_ID: "profile-task", PROFILE_ONLY: "yes" }),
    });

    await startPtyExecution("t1", "");

    expect(vi.mocked(createSession).mock.calls[0][1]).toBe("/custom/bin/claude.cmd");
    expect(vi.mocked(createSession).mock.calls[0][2]).toEqual([
      "--legacy-profile",
      expect.any(String),
      expect.any(String),
    ]);
    expect(vi.mocked(createSession).mock.calls[0][6]).toMatchObject({
      TOWER_TASK_ID: "t1",
      PROFILE_ONLY: "yes",
    });
  });

  it("cleans the instructions temp directory when launch planning fails", async () => {
    mockDb.task.findUnique.mockResolvedValue({ ...taskWithLabels([]), promptId: "prompt1" });
    mockDb.agentPrompt.findUnique.mockResolvedValue({ content: "selected instructions" });
    vi.mocked(resolveTerminalTargetPlan).mockRejectedValueOnce(new Error("resolution failed"));

    await expect(startPtyExecution("t1", "")).rejects.toThrow("resolution failed");

    expect(fsMocks.rm).toHaveBeenCalledWith(
      "/tmp/tower-pty-unit-test",
      { recursive: true, force: true },
    );
  });

  it("falls back from an unavailable primary target to the next explicit target", async () => {
    const unavailable = terminalTarget("claude", {
      preflightError: { code: "connection_unavailable", message: "safe" },
    });
    const backup = terminalTarget("codex", { order: 1 });
    vi.mocked(resolveTerminalTargetPlan).mockResolvedValue({
      slot: "terminal",
      targets: [unavailable, backup],
      migrationStatus: "complete",
    } as never);
    mockDb.task.findUnique.mockResolvedValue({
      ...taskWithLabels([]),
      promptId: "prompt-1",
      baseBranch: "main",
    });
    mockDb.agentPrompt.findUnique.mockResolvedValue({ content: "prepared once" });
    vi.mocked(createWorktree).mockResolvedValue({
      worktreePath: "/tmp/task-worktree",
      worktreeBranch: "task/t1",
    });

    const result = await startPtyExecution("t1", "prompt-canary");

    expect(createSession).toHaveBeenCalledOnce();
    expect(vi.mocked(createSession).mock.calls[0][1]).toBe("codex");
    expect(mockDb.taskExecution.create).toHaveBeenCalledOnce();
    expect(createWorktree).toHaveBeenCalledOnce();
    expect(fsMocks.mkdtemp).toHaveBeenCalledOnce();
    expect(fsMocks.readFile).toHaveBeenCalledOnce();
    expect((db as unknown as { taskMessage: { findMany: ReturnType<typeof vi.fn> } })
      .taskMessage.findMany).toHaveBeenCalledOnce();
    expect(mockDb.taskExecution.update).toHaveBeenCalledWith({
      where: { id: "exec1" },
      data: expect.objectContaining({
        status: "RUNNING",
        connectionId: "connection-codex",
        modelId: "codex-model",
        targetId: "target-codex",
      }),
    });
    expect(result).toMatchObject({
      connectionId: "connection-codex",
      modelId: "codex-model",
      targetId: "target-codex",
    });
  });

  it("falls back when adapter process planning reports a spawn failure", async () => {
    const primary = terminalTarget("claude");
    primary.cli.adapter.buildSessionProcess = () => {
      throw { code: "SPAWN_FAILED", message: "unsafe-build-detail" };
    };
    const backup = terminalTarget("gemini", { order: 1 });
    vi.mocked(resolveTerminalTargetPlan).mockResolvedValue({
      slot: "terminal",
      targets: [primary, backup],
      migrationStatus: "complete",
    } as never);
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));

    await startPtyExecution("t1", "");

    expect(createSession).toHaveBeenCalledOnce();
    expect(vi.mocked(createSession).mock.calls[0][1]).toBe("gemini");
  });

  it("falls back when PTY creation synchronously fails before a session exists", async () => {
    vi.mocked(resolveTerminalTargetPlan).mockResolvedValue({
      slot: "terminal",
      targets: [terminalTarget("claude"), terminalTarget("codex", { order: 1 })],
      migrationStatus: "complete",
    } as never);
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));
    vi.mocked(createSession)
      .mockImplementationOnce(() => { throw new Error("native spawn failed"); })
      .mockImplementationOnce(() => undefined as never);

    const result = await startPtyExecution("t1", "");

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(result.connectionId).toBe("connection-codex");
    expect(mockDb.taskExecution.create).toHaveBeenCalledOnce();
  });

  it("does not fall back for authentication or unknown planning errors", async () => {
    const primary = terminalTarget("claude");
    primary.cli.adapter.buildSessionProcess = () => {
      throw { code: "AUTHENTICATION_FAILED", message: "secret-auth-detail" };
    };
    vi.mocked(resolveTerminalTargetPlan).mockResolvedValue({
      slot: "terminal",
      targets: [primary, terminalTarget("codex", { order: 1 })],
      migrationStatus: "complete",
    } as never);
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));

    await expect(startPtyExecution("t1", "")).rejects.toMatchObject({ code: "authentication" });
    expect(createSession).not.toHaveBeenCalled();
    expect(mockDb.task.update).toHaveBeenLastCalledWith({
      where: { id: "t1" },
      data: { status: "TODO" },
    });
  });

  it.each([
    [{ code: "PROCESS_CANCELLED", message: "cancel detail" }, "cancelled"],
    [new Error("unknown detail"), "unknown"],
  ] as const)("does not fall back for %s", async (failure, code) => {
    const primary = terminalTarget("claude");
    primary.cli.adapter.buildSessionProcess = () => { throw failure; };
    vi.mocked(resolveTerminalTargetPlan).mockResolvedValue({
      slot: "terminal",
      targets: [primary, terminalTarget("codex", { order: 1 })],
      migrationStatus: "complete",
    } as never);
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));

    await expect(startPtyExecution("t1", "")).rejects.toMatchObject({ code });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("marks the single execution failed and restores task state when all targets fail", async () => {
    vi.mocked(resolveTerminalTargetPlan).mockResolvedValue({
      slot: "terminal",
      targets: [
        terminalTarget("claude", { preflightError: { code: "cli_not_found", message: "safe" } }),
        terminalTarget("codex", { order: 1, preflightError: { code: "connection_disabled", message: "safe" } }),
      ],
      migrationStatus: "complete",
    } as never);
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));

    await expect(startPtyExecution("t1", "")).rejects.toMatchObject({ code: "connection_disabled" });

    expect(mockDb.taskExecution.create).toHaveBeenCalledOnce();
    expect(createSession).not.toHaveBeenCalled();
    expect(mockDb.taskExecution.updateMany).toHaveBeenCalledWith({
      where: { id: "exec1", status: { in: ["PENDING", "RUNNING"] } },
      data: {
        status: "FAILED",
        endedAt: expect.any(Date),
        connectionId: null,
        modelId: null,
        targetId: null,
      },
    });
    expect(mockDb.task.update).toHaveBeenLastCalledWith({
      where: { id: "t1" },
      data: { status: "TODO" },
    });
  });

  it("does not try a backup after createSession succeeds even if the CLI exits immediately", async () => {
    vi.mocked(resolveTerminalTargetPlan).mockResolvedValue({
      slot: "terminal",
      targets: [terminalTarget("claude"), terminalTarget("codex", { order: 1 })],
      migrationStatus: "complete",
    } as never);
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));
    vi.mocked(createSession).mockImplementationOnce((...args) => {
      void args[5](1);
      return undefined as never;
    });

    const result = await startPtyExecution("t1", "");

    expect(result.connectionId).toBe("connection-claude");
    expect(createSession).toHaveBeenCalledOnce();
  });

  it("records only safe target diagnostics", async () => {
    const canaries = ["PROMPT_CANARY", "ARGS_CANARY", "ENV_SECRET_CANARY", "BUFFER_CANARY"];
    const target = terminalTarget("claude");
    target.cli.adapter.buildSessionProcess = ({ cwd }) => ({
      command: "claude",
      args: [canaries[1]],
      cwd,
      envPatch: { TOKEN_SECRET: canaries[2] },
    });
    vi.mocked(resolveTerminalTargetPlan).mockResolvedValue({
      slot: "terminal",
      targets: [target],
      migrationStatus: "complete",
    } as never);
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));

    await startPtyExecution("t1", canaries[0]);

    const diagnosticPayload = JSON.stringify(
      (db as unknown as { aiCapabilityAttempt: { create: ReturnType<typeof vi.fn> } })
        .aiCapabilityAttempt.create.mock.calls,
    );
    for (const canary of canaries) expect(diagnosticPayload).not.toContain(canary);
  });

  it("resumes with the execution snapshot even after the terminal slot changes", async () => {
    const task = taskWithLabels([]);
    const previous = {
      id: "exec-codex",
      taskId: "t1",
      agent: "CODEX_CLI",
      config: "DEFAULT",
      sessionId: "session-1",
      worktreePath: null,
      callbackUrl: null,
      connectionId: "connection-codex",
      modelId: "codex-model",
      targetId: "target-codex",
    };
    mockDb.task.findUnique.mockResolvedValue(task);
    mockDb.taskExecution.findFirst.mockResolvedValue(previous);
    mockDb.taskExecution.update.mockResolvedValue({ ...previous, status: "RUNNING" });
    vi.mocked(resolveFixedCliConnection).mockResolvedValue(terminalTarget("codex") as never);

    await resumePtyExecution("t1", "session-1");

    expect(resolveFixedCliConnection).toHaveBeenCalledWith(
      "connection-codex",
      "codex-model",
      { cwd: process.cwd(), targetId: "target-codex" },
    );
    expect(mockDb.taskExecution.update).toHaveBeenCalledWith({
      where: { id: "exec-codex" },
      data: expect.objectContaining({
        status: "RUNNING",
        endedAt: null,
        connectionId: "connection-codex",
        modelId: "codex-model",
        targetId: "target-codex",
      }),
    });
  });

  it("uses the latest snapshot for direct-mode fresh continue without reading the slot", async () => {
    const latest = {
      id: "exec-direct",
      taskId: "t1",
      agent: "CODEX_CLI",
      sessionId: null,
      worktreePath: null,
      worktreeBranch: null,
      callbackUrl: null,
      forkCommit: null,
      connectionId: "connection-codex",
      modelId: "codex-model",
      targetId: "target-codex",
    };
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));
    mockDb.taskExecution.findFirst.mockResolvedValue(latest);
    vi.mocked(resolveFixedCliConnection).mockResolvedValue(terminalTarget("codex") as never);

    const result = await continueLatestPtyExecution("t1");

    expect(result.connectionId).toBe("connection-codex");
    expect(resolveTerminalTargetPlan).not.toHaveBeenCalled();
    expect(resolveFixedCliConnection).toHaveBeenCalledTimes(2);
    expect(resolveFixedCliConnection).toHaveBeenNthCalledWith(
      2,
      "connection-codex",
      "codex-model",
      { cwd: process.cwd(), targetId: "target-codex" },
    );
  });

  it("uses the latest snapshot and model for isolated continue", async () => {
    const buildSessionProcess = vi.fn(terminalTarget("gemini").cli.adapter.buildSessionProcess);
    const fixedTarget = terminalTarget("gemini");
    fixedTarget.cli.adapter.buildSessionProcess = buildSessionProcess;
    const latest = {
      id: "exec-isolated",
      taskId: "t1",
      agent: "GEMINI_CLI",
      sessionId: null,
      worktreePath: "/tmp/task-worktree",
      worktreeBranch: "task/t1",
      callbackUrl: null,
      forkCommit: "fork",
      connectionId: "connection-gemini",
      modelId: "gemini-model",
      targetId: "target-gemini",
    };
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));
    mockDb.taskExecution.findFirst.mockResolvedValue(latest);
    vi.mocked(resolveFixedCliConnection).mockResolvedValue(fixedTarget as never);

    const result = await continueLatestPtyExecution("t1");

    expect(result).toMatchObject({
      connectionId: "connection-gemini",
      modelId: "gemini-model",
      targetId: "target-gemini",
    });
    expect(buildSessionProcess).toHaveBeenCalledWith(expect.objectContaining({
      mode: { type: "continue" },
      model: "gemini-model",
      cwd: "/tmp/task-worktree",
    }));
    expect(resolveTerminalTargetPlan).not.toHaveBeenCalled();
  });

  it("retries a missing resume session fresh on the same fixed target", async () => {
    const fixedTarget = terminalTarget("claude");
    (fixedTarget.cli.adapter as typeof fixedTarget.cli.adapter & {
      classifySessionFailure: () => { retryableWithFresh: boolean };
    }).classifySessionFailure = () => ({ retryableWithFresh: true });
    const previous = {
      id: "exec-resume",
      taskId: "t1",
      agent: "CLAUDE_CODE",
      sessionId: "gone-session",
      worktreePath: null,
      worktreeBranch: null,
      callbackUrl: null,
      forkCommit: null,
      connectionId: "connection-claude",
      modelId: "claude-model",
      targetId: "target-claude",
    };
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));
    mockDb.taskExecution.findFirst.mockResolvedValue(previous);
    mockDb.taskExecution.findUnique.mockResolvedValue({ ...previous, status: "RUNNING" });
    mockDb.taskExecution.update.mockResolvedValue({ ...previous, status: "RUNNING" });
    vi.mocked(resolveFixedCliConnection).mockResolvedValue(fixedTarget as never);

    await resumePtyExecution("t1", "gone-session");
    const firstExit = vi.mocked(createSession).mock.calls[0][5];
    await firstExit(1);

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(resolveTerminalTargetPlan).not.toHaveBeenCalled();
    expect(resolveFixedCliConnection).toHaveBeenLastCalledWith(
      "connection-claude",
      "claude-model",
      { cwd: process.cwd(), targetId: "target-claude" },
    );
  });

  it("backfills a uniquely mapped legacy execution and never reads the slot", async () => {
    const previous = {
      id: "exec-legacy",
      taskId: "t1",
      agent: "CLAUDE_CODE",
      sessionId: "legacy-session",
      worktreePath: null,
      callbackUrl: null,
      connectionId: null,
      modelId: null,
      targetId: null,
    };
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));
    mockDb.taskExecution.findFirst.mockResolvedValue(previous);
    mockDb.taskExecution.update.mockResolvedValue({ ...previous, status: "RUNNING" });
    vi.mocked(resolveLegacyExecutionCliConnection).mockResolvedValue(terminalTarget("claude") as never);

    await resumePtyExecution("t1", "legacy-session");

    expect(resolveLegacyExecutionCliConnection).toHaveBeenCalledWith(
      "CLAUDE_CODE",
      { cwd: process.cwd(), targetId: null },
    );
    expect(mockDb.taskExecution.update).toHaveBeenCalledWith({
      where: { id: "exec-legacy" },
      data: {
        connectionId: "connection-claude",
        modelId: "claude-model",
        targetId: "target-claude",
      },
    });
    expect(resolveTerminalTargetPlan).not.toHaveBeenCalled();
  });

  it("rejects an unmapped legacy execution without falling back", async () => {
    const previous = {
      id: "exec-plugin",
      taskId: "t1",
      agent: "CLI_PLUGIN",
      sessionId: "plugin-session",
      worktreePath: null,
      callbackUrl: null,
      connectionId: null,
      modelId: null,
      targetId: null,
    };
    mockDb.task.findUnique.mockResolvedValue(taskWithLabels([]));
    mockDb.taskExecution.findFirst.mockResolvedValue(previous);
    vi.mocked(resolveLegacyExecutionCliConnection).mockRejectedValue({
      code: "connection_unavailable",
      message: "The configured connection is unavailable",
    });

    await expect(resumePtyExecution("t1", "plugin-session"))
      .rejects.toMatchObject({ code: "connection_unavailable" });
    expect(resolveTerminalTargetPlan).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
});
