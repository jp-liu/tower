// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Drives the real startPtyExecution with the PTY spawn stubbed out, so the
// assertions read the actual --append-system-prompt the CLI would receive.

vi.mock("@/lib/db", () => ({
  db: {
    task: { findUnique: vi.fn(), update: vi.fn() },
    taskMessage: { findMany: vi.fn(async () => []) },
    taskExecution: {
      count: vi.fn(async () => 0),
      updateMany: vi.fn(),
      create: vi.fn(async () => ({ id: "exec1" })),
      update: vi.fn(),
    },
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
    adapter: {
      buildSpawnArgs: ({ extraArgs }: { extraArgs: string[] }) => ({
        command: "claude",
        args: extraArgs,
        env: {},
      }),
      buildEnvOverrides: () => ({}),
    },
    provider: { agentFieldValue: "CLAUDE_CODE" },
    model: null,
  })),
}));

import { db } from "@/lib/db";
import { createSession } from "@/lib/pty/session-store";
import { startPtyExecution } from "@/actions/agent-actions";

const mockDb = db as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
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

/** The --append-system-prompt value handed to the spawned CLI. */
function injectedDirective(): string {
  const args = vi.mocked(createSession).mock.calls[0][2] as string[];
  return args[args.indexOf("--append-system-prompt") + 1];
}

describe("startPtyExecution directive selection", () => {
  beforeEach(() => {
    vi.mocked(createSession).mockClear();
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
});
