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

const CODEX_MODELS = ["o4-mini", "o3", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "codex-mini-latest"];

export class CodexCliAdapter implements CliAdapter {

  buildSpawnArgs(opts: CliSpawnOptions): CliSpawnResult {
    // Codex uses subcommands: `codex resume <id>` / `codex resume --last`
    // Fresh start: `codex --full-auto [extraArgs] "prompt"`
    const args: string[] = [];

    if (opts.resumeSessionId) {
      // `codex resume <sessionId>`
      args.push("resume", opts.resumeSessionId);
    } else if (opts.continueLatest) {
      // `codex resume --last`
      args.push("resume", "--last");
    } else {
      // Fresh start: `codex --full-auto [extraArgs] "prompt"`
      args.push("--full-auto");

      if (opts.extraArgs?.length) {
        args.push(...opts.extraArgs);
      }

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
  // Hooks — METHOD: file write to ~/.codex/hooks.json + [features] flag in config.toml
  //
  // Codex CLI 1.x exposes no `codex hook add` subcommand (verified via
  // `codex --help`). We write hooks.json and toggle `[features] codex_hooks=true`
  // in config.toml. Hook entries we create are always invocations of OUR scripts
  // (session-start-hook.js, post-tool-hook.js, stop-hook.js) — that filename
  // string is the marker for clean uninstall. Re-check on every Codex release.
  // ===========================================================================

  async installHooks(_apiUrl: string): Promise<InstallResult> {
    try {
      const hooks = this.readHooks();
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
        this.writeHooks(hooks);
        this.ensureHooksFeatureEnabled();
      }
      return { ok: true, method: "file", detail: this.getHooksPath() };
    } catch (err) {
      return {
        ok: false,
        method: "file",
        detail: this.getHooksPath(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Repair stale Tower hook paths in-place — `~/.codex/hooks.toml` may still
   * contain entries that 0.2.5/0.2.6 wrote with broken paths under
   * `.next/standalone/scripts/`. Rewrite ONLY existing entries to the
   * current `TOWER_PACKAGE_ROOT`; never adds new ones.
   */
  async repairHookPaths(): Promise<void> {
    try {
      const hooks = this.readHooks();
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
        this.writeHooks(hooks);
        this.ensureHooksFeatureEnabled();
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
      const hooks = this.readHooks();
      const hookFiles = ["session-start-hook.js", "post-tool-hook.js", "stop-hook.js"];

      for (const event of ["SessionStart", "PostToolUse", "Stop"]) {
        const entries = this.getHookArray(hooks, event);
        hooks[event] = entries.filter(
          (e) => !e.hooks?.some((h: { command?: string }) =>
            hookFiles.some((f) => h.command?.includes(f))
          )
        );
      }

      this.writeHooks(hooks);
      return { ok: true, method: "file", detail: this.getHooksPath() };
    } catch (err) {
      return {
        ok: false,
        method: "file",
        detail: this.getHooksPath(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async isHooksInstalled(): Promise<boolean> {
    const hooks = this.readHooks();
    const entries = this.getHookArray(hooks, "PostToolUse");
    return this.hasHook(entries, "post-tool-hook.js");
  }

  // ===========================================================================
  // MCP — METHOD: CLI (`codex mcp add` / `codex mcp remove` / `codex mcp get`)
  //
  // codex mcp add <name> [--env K=V ...] -- <command> <args...>
  // The `-c, --config` global flag is NOT used here — installs go into the
  // default user config (~/.codex/config.toml). Project-scope is not currently
  // supported by Codex MCP, so opts.scope is informational only.
  // ===========================================================================

  async installMcp(server: McpServerConfig, opts: McpInstallOptions = {}): Promise<InstallResult> {
    const cmd = this.resolveCommand();
    const args = ["mcp", "add", server.name];
    if (server.env) {
      for (const [k, v] of Object.entries(server.env)) {
        args.push("--env", `${k}=${v}`);
      }
    }
    args.push("--", server.command, ...server.args);
    try {
      // Replace any existing entry so updates land cleanly.
      await this.runCli(cmd, ["mcp", "remove", server.name], opts.cwd).catch(() => {});
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
    const cmd = this.resolveCommand();
    const args = ["mcp", "remove", name];
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
    const cmd = this.resolveCommand();
    try {
      await this.runCli(cmd, ["mcp", "get", name], opts.cwd, 5000);
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Skills — METHOD: symlink to ~/.codex/skills/<name>
  //
  // Codex CLI 1.x added experimental skills support (Dec 2025) via a directory
  // scan of $CODEX_HOME/skills (default ~/.codex/skills). No `codex skill add`
  // command exists. We symlink so source edits in <repo>/skills propagate, and
  // we can safely identify our installs (lstat → isSymbolicLink + readlink).
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
        // Windows junctions show up as both `isSymbolicLink` and `isDirectory`,
        // so accept either form when checking for a link we own.
        if (existing.isSymbolicLink() || (process.platform === "win32" && existing.isDirectory())) {
          try {
            const current = await fs.promises.readlink(target);
            if (path.resolve(current) === path.resolve(sourceDir)) {
              return { ok: true, method: "symlink", detail: `${target} → ${sourceDir} (already)` };
            }
            await fs.promises.unlink(target);
          } catch {
            if (!existing.isSymbolicLink()) {
              return {
                ok: false,
                method: "symlink",
                detail: target,
                error: `Refusing to overwrite non-symlink at ${target}`,
              };
            }
          }
        } else {
          return {
            ok: false,
            method: "symlink",
            detail: target,
            error: `Refusing to overwrite non-symlink at ${target}`,
          };
        }
      }

      // On Windows, `type: "dir"` needs Admin / Developer Mode / Symlink
      // privilege; `type: "junction"` is an NTFS reparse point that any
      // user can create and behaves identically for the read-only scan
      // Codex does over `~/.codex/skills/`. POSIX always uses `dir`.
      const linkType = process.platform === "win32" ? "junction" : "dir";
      await fs.promises.symlink(sourceDir, target, linkType);
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
   * Run a CLI subcommand without a shell. Used for `codex mcp ...` operations.
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
    return CODEX_MODELS;
  }

  getConfigDir(): string {
    return path.join(os.homedir(), ".codex");
  }

  getSettingsPath(): string {
    return path.join(this.getConfigDir(), "config.toml");
  }

  getSessionsDir(): string {
    return path.join(this.getConfigDir(), "sessions");
  }

  getApiKeyInfo(): { envVar: string; required: boolean } {
    return { envVar: "OPENAI_API_KEY", required: false };
  }

  buildHelloProbeArgs(prompt: string): { command: string; args: string[] } {
    return {
      command: this.resolveCommand(),
      args: ["exec", prompt],
    };
  }

  /** Resolve codex binary — env var > platform-aware resolution. */
  resolveCommand(): string {
    if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
    return resolveCommandPathSync("codex");
  }

  // -- hooks.json helpers ---------------------------------------------------

  private getHooksPath(): string {
    return path.join(this.getConfigDir(), "hooks.json");
  }

  private readHooks(): Record<string, unknown> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.getHooksPath(), "utf-8")) as Record<string, unknown>;
      return (raw["hooks"] as Record<string, unknown>) ?? {};
    } catch {
      return {};
    }
  }

  private writeHooks(hooks: Record<string, unknown>): void {
    const dir = this.getConfigDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.getHooksPath(), JSON.stringify({ hooks }, null, 2), "utf-8");
  }

  /** Ensure `[features] codex_hooks = true` in config.toml so hooks actually fire. */
  private ensureHooksFeatureEnabled(): void {
    const tomlPath = this.getSettingsPath();
    let content = "";
    try { content = fs.readFileSync(tomlPath, "utf-8"); } catch { /* file may not exist */ }

    if (/codex_hooks\s*=\s*true/.test(content)) return;

    // Append or update the feature flag
    if (/\[features\]/.test(content)) {
      // Section exists — append under it
      content = content.replace(/\[features\]/, "[features]\ncodex_hooks = true");
    } else {
      content += "\n[features]\ncodex_hooks = true\n";
    }

    const dir = this.getConfigDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tomlPath, content, "utf-8");
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
