import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeCliAdapter } from "../adapters/cli/claude-cli-adapter";
import type { CliSpawnOptions } from "../types";

describe("ClaudeCliAdapter", () => {
  let adapter: ClaudeCliAdapter;

  beforeEach(() => {
    adapter = new ClaudeCliAdapter();
  });

  describe("buildSpawnArgs", () => {
    const baseOpts: CliSpawnOptions = {
      taskId: "ctask123456789012345678",
      prompt: "Fix the bug",
      cwd: "/project",
    };

    it("builds fresh start args with prompt as last argument", () => {
      const result = adapter.buildSpawnArgs(baseOpts);
      expect(result.command).toBe("claude");
      expect(result.args[result.args.length - 1]).toBe("Fix the bug");
      expect(result.initialInput).toBeUndefined();
    });

    it("builds resume args with --resume flag", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        resumeSessionId: "session-abc-123",
      });
      expect(result.args).toContain("--resume");
      expect(result.args).toContain("session-abc-123");
      expect(result.args[result.args.length - 1]).not.toBe("Fix the bug");
    });

    it("builds continue args with --continue flag and no prompt", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        continueLatest: true,
      });
      expect(result.args).toContain("--continue");
      expect(result.args).not.toContain("Fix the bug");
    });

    it("merges profileArgs into args", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        profileArgs: ["--model", "opus"],
      });
      expect(result.args).toContain("--model");
      expect(result.args).toContain("opus");
    });

    it("merges profileEnvVars into env", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        profileEnvVars: { CUSTOM_VAR: "value" },
      });
      expect(result.env.CUSTOM_VAR).toBe("value");
    });
  });

  describe("buildEnvOverrides", () => {
    it("returns TOWER_* env vars", () => {
      const env = adapter.buildEnvOverrides({
        taskId: "ctask123",
        taskTitle: "Test task",
        apiUrl: "http://localhost:3000",
      });
      expect(env.TOWER_TASK_ID).toBe("ctask123");
      expect(env.TOWER_TASK_TITLE).toBe("Test task");
      expect(env.TOWER_API_URL).toBe("http://localhost:3000");
      expect(env.TOWER_STARTED_AT).toBeDefined();
    });

    it("includes CALLBACK_URL when provided", () => {
      const env = adapter.buildEnvOverrides({
        taskId: "ctask123",
        taskTitle: "Test",
        apiUrl: "http://localhost:3000",
        callbackUrl: "http://external/callback",
      });
      expect(env.CALLBACK_URL).toBe("http://external/callback");
    });

    it("omits CALLBACK_URL when not provided", () => {
      const env = adapter.buildEnvOverrides({
        taskId: "ctask123",
        taskTitle: "Test",
        apiUrl: "http://localhost:3000",
      });
      expect(env.CALLBACK_URL).toBeUndefined();
    });
  });

  describe("metadata", () => {
    it("returns correct config paths", () => {
      expect(adapter.getConfigDir()).toContain(".claude");
      expect(adapter.getSettingsPath()).toContain("settings.json");
      expect(adapter.getSessionsDir()).toContain("projects");
    });
  });
});
