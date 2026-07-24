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

// Drives the real startPtyExecution with the PTY spawn stubbed out, so the
// assertions read the actual --append-system-prompt the CLI would receive.

vi.mock("@/lib/db", () => ({
  db: {
    task: { findUnique: vi.fn(), update: vi.fn() },
    taskMessage: { findMany: vi.fn(async () => []) },
    agentPrompt: { findUnique: vi.fn() },
    taskExecution: {
      count: vi.fn(async () => 0),
      updateMany: vi.fn(),
      create: vi.fn(async () => ({ id: "exec1" })),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    cliProfile: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/pty/session-store", () => ({ createSession: vi.fn() }));
vi.mock("@/lib/harness/harness-message", () => ({ cancelOpenAsks: vi.fn(async () => {}) }));
vi.mock("@/lib/worktree", () => ({ createWorktree: vi.fn() }));
// No SystemConfig override in this test → readConfigValue returns the passed default,
// which is exactly what CONFIG_DEFAULTS carries.
vi.mock("@/lib/config-reader", () => ({
  readConfigValue: vi.fn(async (_key: string, fallback: unknown) => fallback),
}));
vi.mock("@/lib/ai/capability-resolver", () => ({
  resolveCliAdapter: vi.fn(async () => ({
    provider: {
      name: "claude",
      agentFieldValue: "CLAUDE_CODE",
      cli: { plugin: { manifest: { command: { default: "claude", aliases: ["claude-code"] } } } },
    },
    model: null,
  })),
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
import { resolveCliAdapter } from "@/lib/ai/capability-resolver";
import { providerRegistry } from "@/lib/ai/providers";
import { resumePtyExecution, startPtyExecution } from "@/actions/agent-actions";

const mockDb = db as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  agentPrompt: { findUnique: ReturnType<typeof vi.fn> };
  taskExecution: {
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
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
    cli: { plugin: { manifest: { command: commands } } },
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
    vi.mocked(resolveCliAdapter).mockResolvedValue({
      adapter: {} as never,
      provider: cliProvider("claude"),
      model: undefined,
    } as unknown as Awaited<ReturnType<typeof resolveCliAdapter>>);
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

    await expect(startPtyExecution("t1", "")).rejects.toThrow("spawn failed");
    expect(mockDb.taskExecution.updateMany).toHaveBeenCalledWith({
      where: { id: "exec1", status: "RUNNING" },
      data: { status: "FAILED", endedAt: expect.any(Date) },
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
      vi.mocked(resolveCliAdapter).mockResolvedValue({
        adapter: {} as never,
        provider: cliProvider(providerName),
        model: undefined,
      } as unknown as Awaited<ReturnType<typeof resolveCliAdapter>>);

      await startPtyExecution("t1", "");

      expect(providerRegistry.createResolvedCliAdapter).toHaveBeenCalledWith(providerName, process.cwd(), undefined);
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

    expect(providerRegistry.createResolvedCliAdapter).toHaveBeenCalledWith(
      "claude",
      process.cwd(),
      "/custom/bin/claude.cmd",
    );
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
    vi.mocked(providerRegistry.createResolvedCliAdapter).mockRejectedValueOnce(new Error("resolution failed"));

    await expect(startPtyExecution("t1", "")).rejects.toThrow("resolution failed");

    expect(fsMocks.rm).toHaveBeenCalledWith(
      "/tmp/tower-pty-unit-test",
      { recursive: true, force: true },
    );
  });

  it("resumes with execution.agent even after the terminal slot changes", async () => {
    const task = taskWithLabels([]);
    const previous = {
      id: "exec-codex",
      taskId: "t1",
      agent: "CODEX_CLI",
      config: "DEFAULT",
      sessionId: "session-1",
      worktreePath: null,
      callbackUrl: null,
    };
    mockDb.task.findUnique.mockResolvedValue(task);
    mockDb.taskExecution.findFirst.mockResolvedValue(previous);
    mockDb.taskExecution.update.mockResolvedValue({ ...previous, status: "RUNNING" });
    vi.mocked(providerRegistry.getByAgentFieldValue).mockReturnValue(cliProvider("codex") as never);
    vi.mocked(resolveCliAdapter).mockResolvedValue({
      adapter: {} as never,
      provider: cliProvider("codex"),
      model: undefined,
    } as unknown as Awaited<ReturnType<typeof resolveCliAdapter>>);

    await resumePtyExecution("t1", "session-1");

    expect(resolveCliAdapter).toHaveBeenCalledWith("terminal", "codex");
    expect(mockDb.taskExecution.update).toHaveBeenCalledWith({
      where: { id: "exec-codex" },
      data: { status: "RUNNING", endedAt: null },
    });
  });
});
