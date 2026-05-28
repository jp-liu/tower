import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveCommandPathSync } from "@/lib/platform";
import { getPackageRoot } from "@/lib/tower-paths";
import type {
  CliAdapter,
  CliSpawnOptions,
  CliSpawnResult,
  InstallResult,
  McpInstallOptions,
  McpServerConfig,
} from "../../types";

const CLAUDE_MODELS = ["sonnet", "opus", "haiku", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];

export class ClaudeCliAdapter implements CliAdapter {

  buildSpawnArgs(opts: CliSpawnOptions): CliSpawnResult {
    const args: string[] = [
      "--dangerously-skip-permissions",
    ];

    if (opts.extraArgs?.length) {
      args.push(...opts.extraArgs);
    }

    if (opts.resumeSessionId) {
      args.push("--resume", opts.resumeSessionId);
    } else if (opts.continueLatest) {
      args.push("--continue");
    } else {
      if (opts.prompt) {
        args.push(opts.prompt);
      }
    }

    const env: Record<string, string> = {
      ...(opts.envOverrides ?? {}),
    };

    return {
      command: this.resolveCommand(),
      args,
      env,
    };
  }

  buildEnvOverrides(opts: {
    taskId: string;
    taskTitle: string;
    apiUrl: string;
    callbackUrl?: string;
  }): Record<string, string> {
    const env: Record<string, string> = {
      TOWER_TASK_ID: opts.taskId,
      TOWER_TASK_TITLE: opts.taskTitle,
      TOWER_STARTED_AT: new Date().toISOString(),
      TOWER_API_URL: opts.apiUrl,
    };
    if (opts.callbackUrl) {
      env.CALLBACK_URL = opts.callbackUrl;
    }
    return env;
  }

  // ===========================================================================
  // Hooks — METHOD: file write
  //
  // Claude CLI 4.x exposes no `claude hook add` subcommand, so we have to write
  // ~/.claude/settings.json directly. We only touch hook entries whose command
  // string includes one of OUR scripts (session-start-hook.js, post-tool-hook.js,
  // stop-hook.js) — that filename match acts as a marker for clean uninstall.
  // Re-check on every Claude release; switch to CLI as soon as it lands.
  // ===========================================================================

  async installHooks(_apiUrl: string): Promise<InstallResult> {
    try {
      const settings = this.readSettings();
      const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
      const root = getPackageRoot().replace(/\\/g, "/");
      const sessionStart = path.join(root, "scripts", "session-start-hook.js").replace(/\\/g, "/");
      const postTool = path.join(root, "scripts", "post-tool-hook.js").replace(/\\/g, "/");
      const stop = path.join(root, "scripts", "stop-hook.js").replace(/\\/g, "/");
      let changed = false;

      changed = this.upsertHook(hooks, "SessionStart", "session-start-hook.js", {
        hooks: [{ command: `node "${sessionStart}"`, timeout: 5, type: "command" }],
      }) || changed;

      changed = this.upsertHook(hooks, "PostToolUse", "post-tool-hook.js", {
        hooks: [{ command: `node "${postTool}"`, timeout: 10, type: "command" }],
        matcher: "Write|Edit|MultiEdit",
      }) || changed;

      changed = this.upsertHook(hooks, "Stop", "stop-hook.js", {
        hooks: [{ command: `node "${stop}"`, timeout: 5, type: "command" }],
      }) || changed;

      if (changed) {
        settings["hooks"] = hooks;
        this.writeSettings(settings);
      }

      return { ok: true, method: "file", detail: this.getSettingsPath() };
    } catch (err) {
      return {
        ok: false,
        method: "file",
        detail: this.getSettingsPath(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Repair stale Tower hook paths in-place — `~/.claude/settings.json` may
   * still contain entries that 0.2.5/0.2.6 wrote with broken paths under
   * `.next/standalone/scripts/`. Rewrite ONLY existing entries to the
   * current `TOWER_PACKAGE_ROOT`; never adds new ones (the user opts into
   * hooks via Test Connection, not silently on startup).
   */
  async repairHookPaths(): Promise<void> {
    try {
      const settings = this.readSettings();
      const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
      const root = getPackageRoot().replace(/\\/g, "/");
      const map: Array<[string, string]> = [
        ["SessionStart", "session-start-hook.js"],
        ["PostToolUse", "post-tool-hook.js"],
        ["Stop", "stop-hook.js"],
      ];
      let changed = false;
      for (const [event, filename] of map) {
        const entries = this.getHookArray(hooks, event);
        const idx = entries.findIndex((e) =>
          e?.hooks?.some?.((h: { command?: string }) => h.command?.includes(filename))
        );
        if (idx < 0) continue;
        const wantedPath = path.join(root, "scripts", filename).replace(/\\/g, "/");
        const wantedCmd = `node "${wantedPath}"`;
        const hookCmd = entries[idx]?.hooks?.[0];
        if (!hookCmd || hookCmd.command === wantedCmd) continue;
        hookCmd.command = wantedCmd;
        hooks[event] = entries;
        changed = true;
      }
      if (changed) {
        settings["hooks"] = hooks;
        this.writeSettings(settings);
      }
    } catch {
      // Best-effort — never throw out of a repair call.
    }
  }

  /**
   * Install-or-refresh a hook entry. Removes any existing entries that
   * reference our `filename` (caters for stale paths from older Tower versions
   * that wrote `process.cwd()/scripts/...` from inside `.next/standalone/`)
   * and pushes the freshly-built entry. Returns true when settings changed.
   */
  private upsertHook(
    hooks: Record<string, unknown>,
    event: string,
    filename: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entry: any,
  ): boolean {
    const entries = this.getHookArray(hooks, event);
    const wanted = entry?.hooks?.[0]?.command as string | undefined;

    const existingIndex = entries.findIndex((e) =>
      e?.hooks?.some?.((h: { command?: string }) => h.command?.includes(filename))
    );

    if (existingIndex >= 0) {
      const current = entries[existingIndex]?.hooks?.[0]?.command as string | undefined;
      if (current === wanted) return false;
      entries.splice(existingIndex, 1);
    }

    entries.push(entry);
    hooks[event] = entries;
    return true;
  }

  async uninstallHooks(): Promise<InstallResult> {
    try {
      const settings = this.readSettings();
      const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
      const hookFiles = ["session-start-hook.js", "post-tool-hook.js", "stop-hook.js"];

      for (const event of ["SessionStart", "PostToolUse", "Stop"]) {
        const entries = this.getHookArray(hooks, event);
        hooks[event] = entries.filter(
          (e) => !e.hooks?.some((h: { command?: string }) =>
            hookFiles.some((f) => h.command?.includes(f))
          )
        );
      }

      settings["hooks"] = hooks;
      this.writeSettings(settings);
      return { ok: true, method: "file", detail: this.getSettingsPath() };
    } catch (err) {
      return {
        ok: false,
        method: "file",
        detail: this.getSettingsPath(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async isHooksInstalled(): Promise<boolean> {
    const settings = this.readSettings();
    const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
    // Consider installed if the PostToolUse hook exists (primary hook)
    const entries = this.getHookArray(hooks, "PostToolUse");
    return this.hasHook(entries, "post-tool-hook.js");
  }

  // ===========================================================================
  // MCP — METHOD: CLI (`claude mcp add-json` / `claude mcp remove` / `claude mcp get`)
  //
  // We deliberately do NOT edit ~/.claude.json or ~/.claude/settings.json directly:
  // those storage formats have changed across Claude versions (4.x moved user-scope
  // mcpServers from settings.json to ~/.claude.json). Going through the CLI keeps
  // us forward-compatible and lets `/mcp` immediately see the new server.
  // ===========================================================================

  async installMcp(server: McpServerConfig, opts: McpInstallOptions = {}): Promise<InstallResult> {
    const scope = opts.scope ?? "user";
    const json: Record<string, unknown> = { command: server.command, args: server.args };
    if (server.env && Object.keys(server.env).length > 0) json.env = server.env;
    const cmd = this.resolveCommand();
    const args = ["mcp", "add-json", "-s", scope, server.name, JSON.stringify(json)];
    try {
      // Replace any existing entry at this scope so updates land cleanly.
      await this.runCli(cmd, ["mcp", "remove", "-s", scope, server.name], opts.cwd).catch(() => {
        // Non-existent server → claude exits non-zero. Safe to ignore.
      });
      await this.runCli(cmd, args, opts.cwd);
      return { ok: true, method: "cli", detail: `${cmd} ${args.join(" ")}` };
    } catch (err) {
      return {
        ok: false,
        method: "cli",
        detail: `${cmd} ${args.join(" ")}`,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async uninstallMcp(name: string, opts: McpInstallOptions = {}): Promise<InstallResult> {
    const scope = opts.scope ?? "user";
    const cmd = this.resolveCommand();
    const args = ["mcp", "remove", "-s", scope, name];
    try {
      await this.runCli(cmd, args, opts.cwd);
      return { ok: true, method: "cli", detail: `${cmd} ${args.join(" ")}` };
    } catch (err) {
      return {
        ok: false,
        method: "cli",
        detail: `${cmd} ${args.join(" ")}`,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async isMcpInstalled(name: string, opts: McpInstallOptions = {}): Promise<boolean> {
    // `claude mcp get <name>` exits 0 when found, non-zero otherwise. Note: the
    // command searches across all scopes — sufficient for our "is it visible to
    // Claude" check. If we ever need scope-specific detection, add `--scope`.
    const cmd = this.resolveCommand();
    try {
      await this.runCli(cmd, ["mcp", "get", name], opts.cwd, 5000);
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Skills — METHOD: symlink to ~/.claude/skills/<name>
  //
  // Claude discovers skills by directory scan; there is no `claude skill add`.
  // Symlink (vs copy) gives us:
  //   - live updates from <repo>/skills/<name>
  //   - safe ownership detection (lstat → isSymbolicLink + readlink target check)
  //   - clean uninstall (only delete if the link still points into our repo)
  // Pattern adopted from paperclip's local-cli installer.
  // ===========================================================================

  async installSkill(skillName: string, sourceDir: string): Promise<InstallResult> {
    const target = path.join(this.getConfigDir(), "skills", skillName);
    try {
      if (!fs.existsSync(sourceDir)) {
        return {
          ok: false,
          method: "symlink",
          detail: target,
          error: `Source skill dir does not exist: ${sourceDir}`,
        };
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });

      const existing = await fs.promises.lstat(target).catch(() => null);
      if (existing) {
        if (existing.isSymbolicLink()) {
          const current = await fs.promises.readlink(target);
          if (path.resolve(current) === path.resolve(sourceDir)) {
            return { ok: true, method: "symlink", detail: `${target} → ${sourceDir} (already)` };
          }
          await fs.promises.unlink(target);
        } else {
          // Real directory / file at target — refuse to overwrite user data.
          return {
            ok: false,
            method: "symlink",
            detail: target,
            error: `Refusing to overwrite non-symlink at ${target}`,
          };
        }
      }

      await fs.promises.symlink(sourceDir, target, "dir");
      return { ok: true, method: "symlink", detail: `${target} → ${sourceDir}` };
    } catch (err) {
      return {
        ok: false,
        method: "symlink",
        detail: target,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async uninstallSkill(skillName: string): Promise<InstallResult> {
    const target = path.join(this.getConfigDir(), "skills", skillName);
    try {
      const stat = await fs.promises.lstat(target).catch(() => null);
      if (!stat) return { ok: true, method: "symlink", detail: `${target} (already absent)` };
      // Only remove if it's our symlink — never delete a real directory the user owns.
      if (!stat.isSymbolicLink()) {
        return {
          ok: false,
          method: "symlink",
          detail: target,
          error: `Refusing to remove non-symlink at ${target}`,
        };
      }
      await fs.promises.unlink(target);
      return { ok: true, method: "symlink", detail: target };
    } catch (err) {
      return {
        ok: false,
        method: "symlink",
        detail: target,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async isSkillInstalled(skillName: string, expectedSourceDir?: string): Promise<boolean> {
    const target = path.join(this.getConfigDir(), "skills", skillName);
    try {
      const stat = await fs.promises.lstat(target);
      if (!stat.isSymbolicLink()) return false;
      if (!expectedSourceDir) return true;
      const current = await fs.promises.readlink(target);
      const resolved = path.isAbsolute(current) ? current : path.resolve(path.dirname(target), current);
      return path.resolve(resolved) === path.resolve(expectedSourceDir);
    } catch {
      return false;
    }
  }

  /**
   * Run a CLI subcommand without a shell. Used for `claude mcp ...` operations.
   * Throws on non-zero exit or timeout.
   */
  private async runCli(cmd: string, args: string[], cwd?: string, timeoutMs = 10000): Promise<string> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(cmd, args, { cwd, timeout: timeoutMs });
    return stdout;
  }

  async isAvailable(): Promise<boolean> {
    const version = await this.getVersion();
    return version !== null;
  }

  async getVersion(): Promise<string | null> {
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const { resolveSpawnTarget } = await import("@/lib/platform");
      const execFileAsync = promisify(execFile);
      // Wrap `.cmd`/`.bat` shims via cmd.exe on Windows — Node refuses to
      // execFile them directly since CVE-2024-27980.
      const target = await resolveSpawnTarget(this.resolveCommand(), ["--version"]);
      const { stdout } = await execFileAsync(target.command, target.args, { timeout: 5000 });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async getModels(): Promise<string[]> {
    return CLAUDE_MODELS;
  }

  getConfigDir(): string {
    return path.join(os.homedir(), ".claude");
  }

  getSettingsPath(): string {
    return path.join(this.getConfigDir(), "settings.json");
  }

  getSessionsDir(): string {
    return path.join(this.getConfigDir(), "projects");
  }

  getApiKeyInfo(): { envVar: string; required: boolean } {
    return { envVar: "ANTHROPIC_API_KEY", required: false };
  }

  buildHelloProbeArgs(prompt: string): { command: string; args: string[] } {
    return {
      command: this.resolveCommand(),
      args: ["--print", prompt, "--output-format", "stream-json", "--verbose"],
    };
  }

  /** Resolve claude binary — env var > platform-aware resolution.
   *  Public so claude-session.ts can reuse instead of duplicating findClaudeBinary(). */
  resolveCommand(): string {
    if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
    if (process.platform === "win32") {
      const native = resolveCommandPathSync("claude-code");
      if (native !== "claude-code") return native;
    }
    return resolveCommandPathSync("claude");
  }

  private readSettings(): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(this.getSettingsPath(), "utf-8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private writeSettings(data: Record<string, unknown>): void {
    const dir = this.getConfigDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.getSettingsPath(), JSON.stringify(data, null, 2), "utf-8");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getHookArray(hooks: Record<string, unknown>, event: string): any[] {
    const arr = hooks[event];
    return Array.isArray(arr) ? arr : [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hasHook(entries: any[], filename: string): boolean {
    return entries.some(
      (e) => e.hooks?.some((h: { command?: string }) => h.command?.includes(filename))
    );
  }
}
