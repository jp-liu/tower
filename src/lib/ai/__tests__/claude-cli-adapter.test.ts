import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
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
      expect(result.command).toMatch(/claude$/);
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

    it("includes --dangerously-skip-permissions by default", () => {
      const result = adapter.buildSpawnArgs(baseOpts);
      expect(result.args).toContain("--dangerously-skip-permissions");
    });

    it("merges extraArgs into args", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        extraArgs: ["--model", "opus"],
      });
      expect(result.args).toContain("--model");
      expect(result.args).toContain("opus");
    });

    it("merges envOverrides into env", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        envOverrides: { CUSTOM_VAR: "value" },
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

  describe("MCP", () => {
    let settingsPath: string;
    let originalContent: string | null = null;

    beforeEach(() => {
      settingsPath = adapter.getSettingsPath();
      try {
        originalContent = fs.readFileSync(settingsPath, "utf-8");
      } catch {
        originalContent = null;
      }
    });

    afterEach(() => {
      // Restore original settings
      if (originalContent !== null) {
        fs.writeFileSync(settingsPath, originalContent, "utf-8");
      } else {
        // Remove the mcpServers key we added (don't delete the file)
        try {
          const current = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
          delete current.mcpServers;
          fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), "utf-8");
        } catch {
          // file doesn't exist, nothing to clean
        }
      }
    });

    it("installs MCP server config into settings.json", async () => {
      await adapter.installMcp({
        name: "test-tower",
        command: "npx",
        args: ["tsx", "/test/mcp/index.ts"],
      });

      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.mcpServers["test-tower"]).toEqual({
        command: "npx",
        args: ["tsx", "/test/mcp/index.ts"],
      });

      // Clean up
      await adapter.uninstallMcp("test-tower");
    });

    it("reports MCP installed/not installed correctly", async () => {
      expect(await adapter.isMcpInstalled("test-tower")).toBe(false);

      await adapter.installMcp({
        name: "test-tower",
        command: "npx",
        args: ["tsx", "/test/mcp/index.ts"],
      });
      expect(await adapter.isMcpInstalled("test-tower")).toBe(true);

      await adapter.uninstallMcp("test-tower");
      expect(await adapter.isMcpInstalled("test-tower")).toBe(false);
    });

    it("includes env in MCP config when provided", async () => {
      await adapter.installMcp({
        name: "test-tower",
        command: "npx",
        args: ["tsx", "/test/mcp/index.ts"],
        env: { NODE_ENV: "production" },
      });

      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.mcpServers["test-tower"].env).toEqual({ NODE_ENV: "production" });

      await adapter.uninstallMcp("test-tower");
    });
  });
});
