// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliAdapter, CliQueryOptions, CliQueryResult } from "@tower/ai-sdk";
import type { AiCapabilitySlot } from "@tower/ai-runtime";
import type { ResolvedCapabilityTarget } from "../capability-resolver";
import type { TaskChangeData } from "@/lib/task-overview-format";

const mocks = vi.hoisted(() => ({
  plans: new Map<string, ResolvedCapabilityTarget[]>(),
  resolveCapabilityPlan: vi.fn(),
  getApiRuntime: vi.fn(),
  recordAttempt: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../capability-resolver", () => ({
  resolveCapabilityPlan: mocks.resolveCapabilityPlan,
  getApiRuntimeForResolvedTarget: mocks.getApiRuntime,
}));
vi.mock("../capability-config-service", () => ({ recordCapabilityAttemptService: mocks.recordAttempt }));

import { generateDreamingInsight, generateSummaryFromLog } from "@/lib/claude-session";
import { generateChangeSummary } from "@/lib/task-overview";
import { analyzeProjectDirectory } from "@/actions/project-actions";

const tempDirs: string[] = [];

function cliTarget(generate: (options: CliQueryOptions) => Promise<CliQueryResult>): ResolvedCapabilityTarget {
  return {
    targetId: "cli-target", connectionId: "cli-connection", modelId: "cli-model", order: 0,
    kind: "cli", provider: "fixture", connectionName: "Fixture CLI",
    cli: {
      adapter: { generate } as unknown as CliAdapter,
      provider: {} as ResolvedCapabilityTarget["cli"] extends { provider: infer T } ? T : never,
      commandPath: "/fake/fixture-cli",
    },
  };
}

function apiTarget(): ResolvedCapabilityTarget {
  return {
    targetId: "api-target", connectionId: "api-connection", modelId: "api-model", order: 0,
    kind: "api", provider: "openai-compatible", connectionName: "Fixture API",
    api: { protocol: "openai-compatible" },
  };
}

function usePlan(slot: AiCapabilitySlot, targets: ResolvedCapabilityTarget[]): void {
  mocks.plans.set(slot, targets);
}

async function projectDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "tower-entry-analysis-"));
  tempDirs.push(directory);
  await mkdir(path.join(directory, "src"));
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "fixture", dependencies: { next: "16.2.1" } }));
  await writeFile(path.join(directory, "src", "index.ts"), "export const fixture = true;\n");
  return directory;
}

const overview: TaskChangeData = {
  taskId: "task", taskTitle: "Explicit target", projectId: "project", projectName: "Tower",
  files: [{ filename: "src/entry.ts", added: 5, removed: 1, isBinary: false, patch: "" }],
  commitLog: "abc1234 feat: explicit target", commitCount: 1, diffText: "+explicit", assets: [], cwd: "/work",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.plans.clear();
  mocks.resolveCapabilityPlan.mockImplementation(async (slot: string) => ({
    slot, targets: mocks.plans.get(slot) ?? [], migrationStatus: "complete",
  }));
  mocks.recordAttempt.mockResolvedValue(undefined);
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("one-shot production entry target matrix", () => {
  it("runs Summary and task overview through explicit CLI targets", async () => {
    const generate = vi.fn(async (options: CliQueryOptions): Promise<CliQueryResult> => {
      void options;
      return { text: "CLI entry result" };
    });
    usePlan("summary", [cliTarget(generate)]);

    await expect(generateSummaryFromLog("terminal log", "/work", "execution")).resolves.toBe("CLI entry result");
    await expect(generateChangeSummary(overview, "en")).resolves.toBe("CLI entry result");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls.every(([options]) => options.model === "cli-model")).toBe(true);
  });

  it("runs Summary and task overview through explicit API targets", async () => {
    const generate = vi.fn(async (request: { modelId: string }, context?: unknown) => {
      void request;
      void context;
      return {
        text: "API entry result", reasoning: "", toolCalls: [], toolResults: [], finishReason: "stop",
      };
    });
    mocks.getApiRuntime.mockResolvedValue({ generate });
    usePlan("summary", [apiTarget()]);

    await expect(generateSummaryFromLog("terminal log", "/work", "execution")).resolves.toBe("API entry result");
    await expect(generateChangeSummary(overview, "en")).resolves.toBe("API entry result");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls.every(([request]) => request.modelId === "api-model")).toBe(true);
  });

  it("runs Dreaming structured parsing through an explicit CLI target", async () => {
    const generate = vi.fn(async (options: CliQueryOptions): Promise<CliQueryResult> => {
      void options;
      return { text: JSON.stringify({ summary: "CLI dream", insights: [], shouldCreateNote: false }) };
    });
    usePlan("dreaming", [cliTarget(generate)]);

    await expect(generateDreamingInsight("terminal log", "/work", null, "task"))
      .resolves.toMatchObject({ summary: "CLI dream", shouldCreateNote: false });
    expect(generate.mock.calls[0]?.[0].prompt).toContain("[Tower host structured output contract]");
  });

  it("runs Dreaming structured parsing through an explicit API target", async () => {
    const generateStructured = vi.fn(async (request: { modelId: string }, context?: unknown) => {
      void request;
      void context;
      return { summary: "API dream", insights: [], shouldCreateNote: false };
    });
    mocks.getApiRuntime.mockResolvedValue({ generateStructured });
    usePlan("dreaming", [apiTarget()]);

    await expect(generateDreamingInsight("terminal log", "/work", null, "task"))
      .resolves.toMatchObject({ summary: "API dream", shouldCreateNote: false });
    expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({ modelId: "api-model" }), expect.any(Object));
  });

  it("runs Project Analysis through an explicit CLI target", async () => {
    const generate = vi.fn(async (options: CliQueryOptions): Promise<CliQueryResult> => {
      void options;
      return { text: "**Overview:** CLI analysis" };
    });
    usePlan("analysis", [cliTarget(generate)]);
    const directory = await projectDir();

    await expect(analyzeProjectDirectory(directory, "en")).resolves.toContain("CLI analysis");
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ cwd: directory, model: "cli-model" });
  });

  it("runs Project Analysis through an explicit API target", async () => {
    const generate = vi.fn(async (request: { modelId: string }, context?: unknown) => {
      void request;
      void context;
      return {
        text: "**Overview:** API analysis", reasoning: "", toolCalls: [], toolResults: [], finishReason: "stop",
      };
    });
    mocks.getApiRuntime.mockResolvedValue({ generate });
    usePlan("analysis", [apiTarget()]);
    const directory = await projectDir();

    await expect(analyzeProjectDirectory(directory, "en")).resolves.toContain("API analysis");
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ modelId: "api-model" });
  });
});
