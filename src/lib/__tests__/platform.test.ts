import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

/** Helper to create a partial env object for tests without TS errors */
const env = (partial: Record<string, string>) => partial as unknown as NodeJS.ProcessEnv;

// ---------------------------------------------------------------------------
// We test the pure/deterministic functions directly and mock fs/exec for
// the resolution functions so tests run on any host OS.
// ---------------------------------------------------------------------------

describe("platform utilities", () => {
  // =========================================================================
  // isWindows
  // =========================================================================
  describe("isWindows", () => {
    it("returns true for win32", async () => {
      const { isWindows } = await import("@/lib/platform");
      expect(isWindows("win32")).toBe(true);
    });

    it("returns false for darwin", async () => {
      const { isWindows } = await import("@/lib/platform");
      expect(isWindows("darwin")).toBe(false);
    });

    it("returns false for linux", async () => {
      const { isWindows } = await import("@/lib/platform");
      expect(isWindows("linux")).toBe(false);
    });
  });

  // =========================================================================
  // normalizePath
  // =========================================================================
  describe("normalizePath", () => {
    it("converts forward slashes to backslashes on Windows", async () => {
      const { normalizePath } = await import("@/lib/platform");
      const result = normalizePath("D:/project/foo/bar", "win32");
      expect(result).toBe("D:\\project\\foo\\bar");
    });

    it("converts backslashes to forward slashes on Unix", async () => {
      const { normalizePath } = await import("@/lib/platform");
      const result = normalizePath("D:\\project\\foo\\bar", "darwin");
      expect(result).toBe("D:/project/foo/bar");
    });

    it("handles mixed slashes on Windows", async () => {
      const { normalizePath } = await import("@/lib/platform");
      const result = normalizePath("D:\\project/farion1231/cc-switch", "win32");
      expect(result).toBe("D:\\project\\farion1231\\cc-switch");
    });

    it("handles mixed slashes on Unix", async () => {
      const { normalizePath } = await import("@/lib/platform");
      const result = normalizePath("/home/user\\project/foo", "darwin");
      expect(result).toBe("/home/user/project/foo");
    });

    it("collapses .. segments", async () => {
      const { normalizePath } = await import("@/lib/platform");
      const result = normalizePath("/home/user/../other", "darwin");
      expect(result).toBe("/home/other");
    });

    it("collapses . segments", async () => {
      const { normalizePath } = await import("@/lib/platform");
      const result = normalizePath("/home/./user/./project", "darwin");
      expect(result).toBe("/home/user/project");
    });
  });

  // =========================================================================
  // toForwardSlash
  // =========================================================================
  describe("toForwardSlash", () => {
    it("converts backslashes to forward slashes", async () => {
      const { toForwardSlash } = await import("@/lib/platform");
      expect(toForwardSlash("D:\\project\\foo")).toBe("D:/project/foo");
    });

    it("leaves forward slashes unchanged", async () => {
      const { toForwardSlash } = await import("@/lib/platform");
      expect(toForwardSlash("/home/user/project")).toBe("/home/user/project");
    });

    it("handles mixed slashes", async () => {
      const { toForwardSlash } = await import("@/lib/platform");
      expect(toForwardSlash("D:\\project/foo\\bar")).toBe("D:/project/foo/bar");
    });
  });

  // =========================================================================
  // quoteForCmd
  // =========================================================================
  describe("quoteForCmd", () => {
    it("returns empty quoted string for empty input", async () => {
      const { quoteForCmd } = await import("@/lib/platform");
      expect(quoteForCmd("")).toBe('""');
    });

    it("returns unquoted simple argument", async () => {
      const { quoteForCmd } = await import("@/lib/platform");
      expect(quoteForCmd("hello")).toBe("hello");
    });

    it("quotes argument with spaces", async () => {
      const { quoteForCmd } = await import("@/lib/platform");
      expect(quoteForCmd("hello world")).toBe('"hello world"');
    });

    it("doubles internal double quotes", async () => {
      const { quoteForCmd } = await import("@/lib/platform");
      expect(quoteForCmd('say "hi"')).toBe('"say ""hi"""');
    });

    it("flattens newlines to spaces", async () => {
      const { quoteForCmd } = await import("@/lib/platform");
      expect(quoteForCmd("line1\nline2\r\nline3")).toBe('"line1 line2 line3"');
    });

    it("quotes argument with shell meta-characters", async () => {
      const { quoteForCmd } = await import("@/lib/platform");
      expect(quoteForCmd("a&b")).toBe('"a&b"');
      expect(quoteForCmd("a|b")).toBe('"a|b"');
      expect(quoteForCmd("a<b")).toBe('"a<b"');
      expect(quoteForCmd("a>b")).toBe('"a>b"');
      expect(quoteForCmd("a^b")).toBe('"a^b"');
      expect(quoteForCmd("a(b)")).toBe('"a(b)"');
    });

    it("handles path with spaces (Windows-typical)", async () => {
      const { quoteForCmd } = await import("@/lib/platform");
      const result = quoteForCmd("C:\\Program Files\\Git\\bin\\bash.exe");
      expect(result).toBe('"C:\\Program Files\\Git\\bin\\bash.exe"');
    });
  });

  // =========================================================================
  // resolveCommandPath (async)
  // =========================================================================
  describe("resolveCommandPath", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("resolves absolute path if it exists", async () => {
      const fsModule = await import("node:fs");
      vi.spyOn(fsModule.promises, "access").mockResolvedValue(undefined);

      const { resolveCommandPath } = await import("@/lib/platform");
      const result = await resolveCommandPath("/usr/local/bin/claude", {
        platform: "darwin",
      });
      expect(result).toBe("/usr/local/bin/claude");
    });

    it("returns null for absolute path that does not exist", async () => {
      const fsModule = await import("node:fs");
      vi.spyOn(fsModule.promises, "access").mockRejectedValue(new Error("ENOENT"));

      const { resolveCommandPath } = await import("@/lib/platform");
      const result = await resolveCommandPath("/nonexistent/claude", {
        platform: "darwin",
      });
      expect(result).toBeNull();
    });

    it("searches PATH directories on Unix", async () => {
      const fsModule = await import("node:fs");
      const accessSpy = vi.spyOn(fsModule.promises, "access");
      // First dir fails, second succeeds
      accessSpy.mockRejectedValueOnce(new Error("ENOENT"));
      accessSpy.mockResolvedValueOnce(undefined);

      const { resolveCommandPath } = await import("@/lib/platform");
      const result = await resolveCommandPath("claude", {
        env: env({ PATH: "/usr/bin:/usr/local/bin" }),
        platform: "darwin",
      });
      expect(result).toBe(path.join("/usr/local/bin", "claude"));
    });

    it("searches PATH with PATHEXT on Windows", async () => {
      const fsModule = await import("node:fs");
      const accessSpy = vi.spyOn(fsModule.promises, "access");
      // Fail for .EXE, succeed for .CMD
      accessSpy.mockRejectedValueOnce(new Error("ENOENT"));
      accessSpy.mockResolvedValueOnce(undefined);

      const { resolveCommandPath } = await import("@/lib/platform");
      const result = await resolveCommandPath("claude", {
        env: env({ PATH: "C:\\nodejs", PATHEXT: ".EXE;.CMD" }),
        platform: "win32",
      });
      expect(result).toBe(path.join("C:\\nodejs", "claude.CMD"));
    });

    it("returns null when command not found in any PATH dir", async () => {
      const fsModule = await import("node:fs");
      vi.spyOn(fsModule.promises, "access").mockRejectedValue(new Error("ENOENT"));

      const { resolveCommandPath } = await import("@/lib/platform");
      const result = await resolveCommandPath("nonexistent", {
        env: env({ PATH: "/usr/bin" }),
        platform: "darwin",
      });
      expect(result).toBeNull();
    });

    it("resolves relative path against cwd", async () => {
      const fsModule = await import("node:fs");
      vi.spyOn(fsModule.promises, "access").mockResolvedValue(undefined);

      const { resolveCommandPath } = await import("@/lib/platform");
      const result = await resolveCommandPath("./bin/claude", {
        cwd: "/my/project",
        platform: "darwin",
      });
      expect(result).toBe(path.resolve("/my/project", "./bin/claude"));
    });
  });

  // =========================================================================
  // resolveCommandPathSync
  // =========================================================================
  describe("resolveCommandPathSync", () => {
    it("returns command as-is on non-Windows", async () => {
      const { resolveCommandPathSync } = await import("@/lib/platform");
      expect(resolveCommandPathSync("claude", "darwin")).toBe("claude");
    });

    it("returns command with extension as-is", async () => {
      const { resolveCommandPathSync } = await import("@/lib/platform");
      expect(resolveCommandPathSync("claude.cmd", "win32")).toBe("claude.cmd");
    });

    it("returns command with path separator as-is", async () => {
      const { resolveCommandPathSync } = await import("@/lib/platform");
      expect(resolveCommandPathSync("C:\\bin\\claude", "win32")).toBe("C:\\bin\\claude");
      expect(resolveCommandPathSync("/usr/bin/claude", "darwin")).toBe("/usr/bin/claude");
    });

    it("uses where.exe on Windows and prefers .cmd", async () => {
      const mockExec = () => "C:\\nodejs\\claude\nC:\\nodejs\\claude.cmd\n";
      const { resolveCommandPathSync } = await import("@/lib/platform");
      const result = resolveCommandPathSync("claude", "win32", mockExec);
      expect(result).toBe("C:\\nodejs\\claude.cmd");
    });

    it("falls back to first result when no .cmd/.bat/.exe found", async () => {
      const mockExec = () => "C:\\nodejs\\claude\n";
      const { resolveCommandPathSync } = await import("@/lib/platform");
      const result = resolveCommandPathSync("claude", "win32", mockExec);
      expect(result).toBe("C:\\nodejs\\claude");
    });

    it("returns original command when where.exe fails", async () => {
      const mockExec = () => { throw new Error("not found"); };
      const { resolveCommandPathSync } = await import("@/lib/platform");
      const result = resolveCommandPathSync("nonexistent", "win32", mockExec);
      expect(result).toBe("nonexistent");
    });

    it("prefers .exe over extension-less shim", async () => {
      const mockExec = () => "C:\\nodejs\\node\nC:\\nodejs\\node.exe\n";
      const { resolveCommandPathSync } = await import("@/lib/platform");
      const result = resolveCommandPathSync("node", "win32", mockExec);
      expect(result).toBe("C:\\nodejs\\node.exe");
    });
  });

  // =========================================================================
  // resolveSpawnTarget (async)
  // =========================================================================
  describe("resolveSpawnTarget", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("returns command and args unchanged on Unix", async () => {
      const fsModule = await import("node:fs");
      vi.spyOn(fsModule.promises, "access").mockResolvedValue(undefined);

      const { resolveSpawnTarget } = await import("@/lib/platform");
      const result = await resolveSpawnTarget("claude", ["--print", "hello"], {
        env: env({ PATH: "/usr/local/bin" }),
        platform: "darwin",
      });
      expect(result.command).toBe(path.join("/usr/local/bin", "claude"));
      expect(result.args).toEqual(["--print", "hello"]);
    });

    it("wraps .cmd file with cmd.exe on Windows", async () => {
      const fsModule = await import("node:fs");
      vi.spyOn(fsModule.promises, "access").mockResolvedValue(undefined);

      const { resolveSpawnTarget } = await import("@/lib/platform");
      const result = await resolveSpawnTarget("claude", ["--print", "hello"], {
        env: env({ PATH: "C:\\nodejs", PATHEXT: ".CMD", ComSpec: "C:\\WINDOWS\\system32\\cmd.exe" }),
        platform: "win32",
      });
      expect(result.command).toBe("C:\\WINDOWS\\system32\\cmd.exe");
      expect(result.args[0]).toBe("/d");
      expect(result.args[1]).toBe("/s");
      expect(result.args[2]).toBe("/c");
      // The command line should contain the resolved .CMD path and args
      expect(result.args[3]).toContain("claude.CMD");
      expect(result.args[3]).toContain("--print");
      expect(result.args[3]).toContain("hello");
    });

    it("does not wrap .exe on Windows", async () => {
      const fsModule = await import("node:fs");
      const accessSpy = vi.spyOn(fsModule.promises, "access");
      // .EXE found first
      accessSpy.mockResolvedValueOnce(undefined);

      const { resolveSpawnTarget } = await import("@/lib/platform");
      const result = await resolveSpawnTarget("node", ["index.js"], {
        env: env({ PATH: "C:\\nodejs", PATHEXT: ".EXE" }),
        platform: "win32",
      });
      expect(result.command).toBe(path.join("C:\\nodejs", "node.EXE"));
      expect(result.args).toEqual(["index.js"]);
    });

    it("falls back to original command when not found", async () => {
      const fsModule = await import("node:fs");
      vi.spyOn(fsModule.promises, "access").mockRejectedValue(new Error("ENOENT"));

      const { resolveSpawnTarget } = await import("@/lib/platform");
      const result = await resolveSpawnTarget("nonexistent", ["arg"], {
        env: env({ PATH: "/usr/bin" }),
        platform: "darwin",
      });
      expect(result.command).toBe("nonexistent");
      expect(result.args).toEqual(["arg"]);
    });
  });

  // =========================================================================
  // resolveSpawnTargetSync
  // =========================================================================
  describe("resolveSpawnTargetSync", () => {
    it("returns command and args unchanged on Unix", async () => {
      const { resolveSpawnTargetSync } = await import("@/lib/platform");
      const result = resolveSpawnTargetSync("claude", ["--print"], "darwin");
      expect(result.command).toBe("claude");
      expect(result.args).toEqual(["--print"]);
    });

    it("wraps .cmd with cmd.exe on Windows", async () => {
      const mockExec = () => "C:\\nodejs\\claude.cmd\n";
      const { resolveSpawnTargetSync } = await import("@/lib/platform");
      const result = resolveSpawnTargetSync("claude", ["--print", "hello"], "win32", mockExec);
      expect(result.command).toContain("cmd");
      expect(result.args).toContain("/d");
      expect(result.args).toContain("/s");
      expect(result.args).toContain("/c");
    });

    it("quotes arguments with spaces in Windows cmd wrapper", async () => {
      const mockExec = () => "C:\\nodejs\\claude.cmd\n";
      const { resolveSpawnTargetSync } = await import("@/lib/platform");
      const result = resolveSpawnTargetSync(
        "claude",
        ["--append-system-prompt", "hello world\nnew line"],
        "win32",
        mockExec,
      );
      // The /c command line should have properly quoted args
      const cmdLine = result.args[3]; // /d /s /c <commandLine>
      expect(cmdLine).toContain("hello world new line"); // newline flattened
    });

    it("does not wrap .exe on Windows", async () => {
      const mockExec = () => "C:\\nodejs\\node.exe\n";
      const { resolveSpawnTargetSync } = await import("@/lib/platform");
      const result = resolveSpawnTargetSync("node", ["index.js"], "win32", mockExec);
      expect(result.command).toBe("C:\\nodejs\\node.exe");
      expect(result.args).toEqual(["index.js"]);
    });
  });

  // =========================================================================
  // detectTerminals
  // =========================================================================
  // =========================================================================
  // detectShells
  // =========================================================================
  describe("detectShells", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("reads /etc/shells on macOS and returns available shells", async () => {
      const fsModule = await import("node:fs");
      const readFileSpy = vi.spyOn(fsModule.promises, "readFile");
      const accessSpy = vi.spyOn(fsModule.promises, "access");

      readFileSpy.mockResolvedValue(
        "# /etc/shells\n/bin/bash\n/bin/zsh\n/usr/local/bin/fish\n# comment\n\n",
      );
      accessSpy.mockResolvedValue(undefined); // all exist

      const { detectShells } = await import("@/lib/platform");
      const result = await detectShells("darwin");

      expect(result).toEqual([
        { name: "bash", path: "/bin/bash" },
        { name: "zsh", path: "/bin/zsh" },
        { name: "fish", path: "/usr/local/bin/fish" },
      ]);
    });

    it("handles duplicate shell names with suffix", async () => {
      const fsModule = await import("node:fs");
      vi.spyOn(fsModule.promises, "readFile").mockResolvedValue(
        "/bin/bash\n/usr/local/bin/bash\n",
      );
      vi.spyOn(fsModule.promises, "access").mockResolvedValue(undefined);

      const { detectShells } = await import("@/lib/platform");
      const result = await detectShells("linux");

      expect(result[0].name).toBe("bash");
      expect(result[1].name).toBe("bash (2)");
    });

    it("falls back to defaults when /etc/shells unreadable", async () => {
      const fsModule = await import("node:fs");
      vi.spyOn(fsModule.promises, "readFile").mockRejectedValue(new Error("ENOENT"));
      vi.spyOn(fsModule.promises, "access").mockResolvedValue(undefined);

      const { detectShells } = await import("@/lib/platform");
      const result = await detectShells("darwin");

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].path).toMatch(/^\//);
    });
  });

  // =========================================================================
  // detectTerminalApps
  // =========================================================================
  describe("detectTerminalApps", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("detects macOS terminal apps via /Applications", async () => {
      const fsModule = await import("node:fs");
      vi.spyOn(fsModule.promises, "access").mockImplementation(async (p) => {
        if (String(p).includes("Terminal.app")) return undefined;
        throw new Error("ENOENT");
      });

      const { detectTerminalApps } = await import("@/lib/platform");
      const result = await detectTerminalApps("darwin");

      expect(result).toEqual([{ name: "Terminal", value: "Terminal" }]);
    });

    it("returns empty array for linux", async () => {
      const { detectTerminalApps } = await import("@/lib/platform");
      const result = await detectTerminalApps("linux");
      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // ensurePathInEnv
  // =========================================================================
  describe("ensurePathInEnv", () => {
    it("returns env unchanged when PATH is set", async () => {
      const { ensurePathInEnv } = await import("@/lib/platform");
      const input = { PATH: "/usr/bin", HOME: "/home/user" };
      const result = ensurePathInEnv(input, "darwin");
      expect(result.PATH).toBe("/usr/bin");
    });

    it("adds default PATH on Unix when missing", async () => {
      const { ensurePathInEnv } = await import("@/lib/platform");
      const result = ensurePathInEnv({ HOME: "/home/user" }, "darwin");
      expect(result.PATH).toContain("/usr/local/bin");
    });

    it("adds default Path on Windows when missing", async () => {
      const { ensurePathInEnv } = await import("@/lib/platform");
      const result = ensurePathInEnv({ USERPROFILE: "C:\\Users\\test" }, "win32");
      expect(result.Path).toContain("System32");
    });

    it("does not mutate input object", async () => {
      const { ensurePathInEnv } = await import("@/lib/platform");
      const input = { HOME: "/home/user" };
      const result = ensurePathInEnv(input, "darwin");
      expect(input).not.toHaveProperty("PATH");
      expect(result).toHaveProperty("PATH");
    });
  });

  // =========================================================================
  // stripClaudeNestingEnv
  // =========================================================================
  describe("stripClaudeNestingEnv", () => {
    it("removes Claude nesting variables", async () => {
      const { stripClaudeNestingEnv } = await import("@/lib/platform");
      const input = {
        PATH: "/usr/bin",
        CLAUDECODE: "1",
        CLAUDE_CODE_ENTRYPOINT: "/usr/bin/claude",
        CLAUDE_CODE_SESSION: "abc123",
        CLAUDE_CODE_PARENT_SESSION: "parent123",
        HOME: "/home/user",
      };
      const result = stripClaudeNestingEnv(input);
      expect(result).not.toHaveProperty("CLAUDECODE");
      expect(result).not.toHaveProperty("CLAUDE_CODE_ENTRYPOINT");
      expect(result).not.toHaveProperty("CLAUDE_CODE_SESSION");
      expect(result).not.toHaveProperty("CLAUDE_CODE_PARENT_SESSION");
      expect(result.PATH).toBe("/usr/bin");
      expect(result.HOME).toBe("/home/user");
    });

    it("does not mutate input object", async () => {
      const { stripClaudeNestingEnv } = await import("@/lib/platform");
      const input = { CLAUDECODE: "1", HOME: "/home" };
      stripClaudeNestingEnv(input);
      expect(input).toHaveProperty("CLAUDECODE");
    });
  });

  // =========================================================================
  // redactEnvForLogs
  // =========================================================================
  describe("redactEnvForLogs", () => {
    it("redacts sensitive keys", async () => {
      const { redactEnvForLogs } = await import("@/lib/platform");
      const result = redactEnvForLogs({
        ANTHROPIC_API_KEY: "sk-ant-xxx",
        DATABASE_URL: "sqlite://db.sqlite",
        SECRET_VALUE: "hunter2",
        GITHUB_TOKEN: "ghp_xxx",
        HOME: "/home/user",
        COOKIE_JAR: "abc",
        PASSWORD: "pass123",
      });
      expect(result.ANTHROPIC_API_KEY).toBe("***REDACTED***");
      expect(result.SECRET_VALUE).toBe("***REDACTED***");
      expect(result.GITHUB_TOKEN).toBe("***REDACTED***");
      expect(result.COOKIE_JAR).toBe("***REDACTED***");
      expect(result.PASSWORD).toBe("***REDACTED***");
      expect(result.DATABASE_URL).toBe("sqlite://db.sqlite");
      expect(result.HOME).toBe("/home/user");
    });

    it("skips undefined values", async () => {
      const { redactEnvForLogs } = await import("@/lib/platform");
      const result = redactEnvForLogs({ PATH: "/usr/bin", MISSING: undefined });
      expect(result).toEqual({ PATH: "/usr/bin" });
    });
  });
});
