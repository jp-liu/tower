// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ClaudeCliAdapter } from "../adapters/cli/claude-cli-adapter";
import type { CliSpawnOptions } from "../types";

// Hoisted shared state for the child_process mock — every test that touches
// the CLI sees the SAME mock function. dynamic `import("node:child_process")`
// inside the adapter resolves to this module.
const { execCalls, mockBehavior, execFileMock } = vi.hoisted(() => {
  const execCalls: Array<{ cmd: string; args: string[] }> = [];
  const mockBehavior: { fn: (cmd: string, args: string[]) => { stdout: string } } = {
    fn: () => ({ stdout: "" }),
  };
  const execFileMock = (
    cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
  ) => {
    execCalls.push({ cmd, args });
    try {
      const { stdout } = mockBehavior.fn(cmd, args);
      cb(null, { stdout, stderr: "" });
    } catch (err) {
      cb(err as Error, { stdout: "", stderr: "" });
    }
  };
  return { execCalls, mockBehavior, execFileMock };
});

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, execFile: execFileMock };
});

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

  describe("hooks", () => {
    let configDir: string;
    let settingsPath: string;

    beforeEach(() => {
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), "tower-claude-hooks-"));
      settingsPath = path.join(configDir, "settings.json");
      vi.spyOn(adapter, "getConfigDir").mockReturnValue(configDir);
      vi.spyOn(adapter, "getSettingsPath").mockReturnValue(settingsPath);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      fs.rmSync(configDir, { recursive: true, force: true });
    });

    it("requires every Tower hook after installation", async () => {
      await adapter.installHooks("http://localhost:3000");
      expect(await adapter.isHooksInstalled()).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      delete settings.hooks.PreToolUse;
      fs.writeFileSync(settingsPath, JSON.stringify(settings), "utf-8");

      expect(await adapter.isHooksInstalled()).toBe(false);
    });
  });

  describe("MCP (CLI-driven)", () => {
    // installMcp / uninstallMcp / isMcpInstalled shell out to
    // `claude mcp add-json|remove|get`. We mock execFile via vi.mock at module
    // scope so dynamic `import("node:child_process")` inside the adapter sees
    // the same shared mock across every test in this file.
    beforeEach(() => {
      execCalls.length = 0;
      mockBehavior.fn = () => ({ stdout: "" });
    });

    it("installMcp invokes `claude mcp add-json -s user`", async () => {
      const result = await adapter.installMcp({
        name: "test-tower",
        command: "npx",
        args: ["tsx", "/test/mcp/index.ts"],
        env: { NODE_ENV: "production" },
      });

      expect(result.ok).toBe(true);
      expect(result.method).toBe("cli");

      // First call is a best-effort `mcp remove` (idempotent), then `mcp add-json`.
      const addJson = execCalls.find((c) => c.args.includes("add-json"));
      expect(addJson).toBeDefined();
      expect(addJson!.args.slice(0, 4)).toEqual(["mcp", "add-json", "-s", "user"]);
      expect(addJson!.args[4]).toBe("test-tower");
      expect(JSON.parse(addJson!.args[5])).toEqual({
        command: "npx",
        args: ["tsx", "/test/mcp/index.ts"],
        env: { NODE_ENV: "production" },
      });
    });

    it("uninstallMcp invokes `claude mcp remove -s user`", async () => {
      const result = await adapter.uninstallMcp("test-tower");
      expect(result.ok).toBe(true);
      expect(result.method).toBe("cli");
      expect(execCalls[0].args).toEqual(["mcp", "remove", "-s", "user", "test-tower"]);
    });

    it("isMcpInstalled returns true when `claude mcp get` succeeds", async () => {
      mockBehavior.fn = (_cmd, args) => {
        if (args[0] === "mcp" && args[1] === "get") return { stdout: "ok" };
        throw new Error("unexpected");
      };
      expect(await adapter.isMcpInstalled("test-tower")).toBe(true);
    });

    it("isMcpInstalled returns false when `claude mcp get` errors", async () => {
      mockBehavior.fn = () => { throw new Error("not found"); };
      expect(await adapter.isMcpInstalled("test-tower")).toBe(false);
    });
  });

  describe("Skills (symlink)", () => {
    // Use a temp dir as the source skill, then verify symlink target via lstat.
    let sourceDir: string;
    let skillsHome: string;
    let originalConfigDir: string;

    beforeEach(() => {
      sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "tower-skill-src-"));
      fs.writeFileSync(path.join(sourceDir, "SKILL.md"), "# test\n", "utf-8");
      skillsHome = fs.mkdtempSync(path.join(os.tmpdir(), "tower-claude-home-"));
      originalConfigDir = adapter.getConfigDir();
      // Override getConfigDir to point at our temp dir for this suite.
      vi.spyOn(adapter, "getConfigDir").mockReturnValue(skillsHome);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      fs.rmSync(sourceDir, { recursive: true, force: true });
      fs.rmSync(skillsHome, { recursive: true, force: true });
      void originalConfigDir;
    });

    it("installSkill creates a symlink to the source dir", async () => {
      const result = await adapter.installSkill("tower", sourceDir);
      expect(result.ok).toBe(true);
      expect(result.method).toBe("symlink");
      const target = path.join(skillsHome, "skills", "tower");
      const stat = fs.lstatSync(target);
      expect(stat.isSymbolicLink()).toBe(true);
      expect(path.resolve(fs.readlinkSync(target))).toBe(path.resolve(sourceDir));
    });

    it("isSkillInstalled validates the symlink target when given", async () => {
      await adapter.installSkill("tower", sourceDir);
      expect(await adapter.isSkillInstalled("tower")).toBe(true);
      expect(await adapter.isSkillInstalled("tower", sourceDir)).toBe(true);
      expect(await adapter.isSkillInstalled("tower", "/some/other/path")).toBe(false);
    });

    it("uninstallSkill removes only our symlink", async () => {
      await adapter.installSkill("tower", sourceDir);
      const result = await adapter.uninstallSkill("tower");
      expect(result.ok).toBe(true);
      expect(fs.existsSync(path.join(skillsHome, "skills", "tower"))).toBe(false);
    });

    it("uninstallSkill refuses to remove a real directory", async () => {
      const realDir = path.join(skillsHome, "skills", "user-skill");
      fs.mkdirSync(realDir, { recursive: true });
      const result = await adapter.uninstallSkill("user-skill");
      expect(result.ok).toBe(false);
      expect(fs.existsSync(realDir)).toBe(true);
    });
  });
});
