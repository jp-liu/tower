import { describe, it, expect, beforeEach } from "vitest";
import { CodexCliAdapter } from "../adapters/cli/codex-cli-adapter";
import type { CliSpawnOptions } from "../types";

describe("CodexCliAdapter", () => {
  let adapter: CodexCliAdapter;

  beforeEach(() => {
    adapter = new CodexCliAdapter();
  });

  describe("buildSpawnArgs", () => {
    const baseOpts: CliSpawnOptions = {
      taskId: "ctask123456789012345678",
      prompt: "Fix the bug",
      cwd: "/project",
    };

    it("builds fresh start args with --full-auto and prompt as last argument", () => {
      const result = adapter.buildSpawnArgs(baseOpts);
      expect(result.command).toMatch(/codex$/);
      expect(result.args[0]).toBe("--full-auto");
      expect(result.args[result.args.length - 1]).toBe("Fix the bug");
      expect(result.initialInput).toBeUndefined();
    });

    it("builds resume args with `resume <id>` subcommand (no --full-auto)", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        resumeSessionId: "session-abc-123",
      });
      expect(result.args[0]).toBe("resume");
      expect(result.args[1]).toBe("session-abc-123");
      expect(result.args).not.toContain("--full-auto");
      expect(result.args).not.toContain("Fix the bug");
    });

    it("builds continue args with `resume --last` (no --full-auto)", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        continueLatest: true,
      });
      expect(result.args[0]).toBe("resume");
      expect(result.args[1]).toBe("--last");
      expect(result.args).not.toContain("--full-auto");
      expect(result.args).not.toContain("Fix the bug");
    });

    it("includes --full-auto by default on fresh start", () => {
      const result = adapter.buildSpawnArgs(baseOpts);
      expect(result.args).toContain("--full-auto");
    });

    it("merges extraArgs into args on fresh start", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        extraArgs: ["--model", "o3"],
      });
      expect(result.args).toContain("--model");
      expect(result.args).toContain("o3");
      // extraArgs should come after --full-auto but before prompt
      const fullAutoIdx = result.args.indexOf("--full-auto");
      const modelIdx = result.args.indexOf("--model");
      const promptIdx = result.args.indexOf("Fix the bug");
      expect(modelIdx).toBeGreaterThan(fullAutoIdx);
      expect(promptIdx).toBeGreaterThan(modelIdx);
    });

    it("merges envOverrides into env", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        envOverrides: { CUSTOM_VAR: "value" },
      });
      expect(result.env.CUSTOM_VAR).toBe("value");
    });

    it("handles empty prompt on fresh start", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        prompt: "",
      });
      expect(result.args).toContain("--full-auto");
      expect(result.args).not.toContain("");
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

  describe("hooks", () => {
    it("reports hooks as not installed (Codex TOML hooks not yet supported)", async () => {
      expect(await adapter.isHooksInstalled()).toBe(false);
    });
  });

  describe("metadata", () => {
    it("returns correct config paths", () => {
      expect(adapter.getConfigDir()).toContain(".codex");
      expect(adapter.getSettingsPath()).toContain("config.toml");
      expect(adapter.getSessionsDir()).toContain("sessions");
    });
  });

  describe("getApiKeyInfo", () => {
    it("returns OPENAI_API_KEY as non-required", () => {
      const info = adapter.getApiKeyInfo();
      expect(info.envVar).toBe("OPENAI_API_KEY");
      expect(info.required).toBe(false);
    });
  });

  describe("buildHelloProbeArgs", () => {
    it("returns codex exec - for non-interactive probe", () => {
      const probe = adapter.buildHelloProbeArgs();
      expect(probe.command).toMatch(/codex$/);
      expect(probe.args).toContain("exec");
      expect(probe.args).toContain("-");
    });
  });

  describe("MCP interface", () => {
    it("has installMcp, uninstallMcp, isMcpInstalled methods", () => {
      expect(typeof adapter.installMcp).toBe("function");
      expect(typeof adapter.uninstallMcp).toBe("function");
      expect(typeof adapter.isMcpInstalled).toBe("function");
    });
  });
});
