import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    const tmpDir = path.join(__dirname, ".tmp-codex-hooks-test");
    const hooksJsonPath = path.join(tmpDir, "hooks.json");
    const configTomlPath = path.join(tmpDir, "config.toml");

    beforeEach(() => {
      fs.mkdirSync(tmpDir, { recursive: true });
      // Point adapter to temp dir
      vi.spyOn(adapter, "getConfigDir").mockReturnValue(tmpDir);
      vi.spyOn(adapter, "getSettingsPath").mockReturnValue(configTomlPath);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("reports hooks as not installed when hooks.json does not exist", async () => {
      expect(await adapter.isHooksInstalled()).toBe(false);
    });

    it("installs hooks to hooks.json and enables feature flag in config.toml", async () => {
      await adapter.installHooks("http://localhost:3000");

      expect(await adapter.isHooksInstalled()).toBe(true);

      // Verify hooks.json structure
      const raw = JSON.parse(fs.readFileSync(hooksJsonPath, "utf-8"));
      expect(raw.hooks.PostToolUse).toBeDefined();
      expect(raw.hooks.SessionStart).toBeDefined();
      expect(raw.hooks.Stop).toBeDefined();
      expect(raw.hooks.PostToolUse[0].matcher).toBe("Write|Edit|MultiEdit");

      // Verify config.toml has codex_hooks = true
      const toml = fs.readFileSync(configTomlPath, "utf-8");
      expect(toml).toContain("codex_hooks = true");
    });

    it("does not duplicate hooks on repeated install", async () => {
      await adapter.installHooks("http://localhost:3000");
      await adapter.installHooks("http://localhost:3000");

      const raw = JSON.parse(fs.readFileSync(hooksJsonPath, "utf-8"));
      expect(raw.hooks.PostToolUse).toHaveLength(1);
      expect(raw.hooks.SessionStart).toHaveLength(1);
      expect(raw.hooks.Stop).toHaveLength(1);
    });

    it("uninstalls hooks from hooks.json", async () => {
      await adapter.installHooks("http://localhost:3000");
      expect(await adapter.isHooksInstalled()).toBe(true);

      await adapter.uninstallHooks();
      expect(await adapter.isHooksInstalled()).toBe(false);

      const raw = JSON.parse(fs.readFileSync(hooksJsonPath, "utf-8"));
      expect(raw.hooks.PostToolUse).toHaveLength(0);
      expect(raw.hooks.SessionStart).toHaveLength(0);
      expect(raw.hooks.Stop).toHaveLength(0);
    });

    it("preserves existing [features] section when enabling hooks", async () => {
      fs.writeFileSync(configTomlPath, "[features]\nsome_flag = true\n", "utf-8");

      await adapter.installHooks("http://localhost:3000");

      const toml = fs.readFileSync(configTomlPath, "utf-8");
      expect(toml).toContain("codex_hooks = true");
      expect(toml).toContain("some_flag = true");
    });

    it("skips feature flag write if already enabled", async () => {
      fs.writeFileSync(configTomlPath, "[features]\ncodex_hooks = true\n", "utf-8");

      await adapter.installHooks("http://localhost:3000");

      const toml = fs.readFileSync(configTomlPath, "utf-8");
      // Should not have duplicated the flag
      const matches = toml.match(/codex_hooks/g);
      expect(matches).toHaveLength(1);
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
