import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isWindows, quoteForCmd, resolveCommandPathSync } from "@/lib/platform";
import { getPackageRoot } from "@/lib/tower-paths";
import type {
  CliAdapter,
  CliSpawnOptions,
  CliSpawnResult,
  InstallResult,
  McpInstallOptions,
  McpServerConfig,
} from "../../types";

// Model list intentionally empty: concrete Codex model names are version-,
// rollout- and account-dependent (o3 → gpt-5.x churn), and the capability
// resolver only validates `model` when this list is non-empty. Empty = let the
// user's ~/.codex account default win and skip false "model not available"
// errors. Surface real models in the UI later by reading ~/.codex/models_cache.json.
const CODEX_MODELS: string[] = [];

export class CodexCliAdapter implements CliAdapter {

  buildSpawnArgs(opts: CliSpawnOptions): CliSpawnResult {
    // Mirror ClaudeCliAdapter (claude-cli-adapter.ts): the autonomy flag and any
    // extraArgs (e.g. --model) must apply to fresh AND resumed sessions, so they
    // go first — before the fresh/resume/continue branch. Verified on codex-cli
    // 0.145.x: --yolo parses both as a global pre-subcommand option and
    // directly on `codex resume`.
    //
    // --yolo is Codex's documented full-access mode and matches Claude's
    // --dangerously-skip-permissions. Tower terminal is the "agent runs
    // autonomously" surface. Safer alternative if
    // unrestricted host access is a concern: replace the one flag below with
    // "-a","never","-s","workspace-write" — keeps the sandbox, but note codex's
    // workspace-write defaults to NO network, which breaks pnpm install / dev
    // servers. One-line switch; decision deferred to the user (see design doc §7).
    // --dangerously-bypass-hook-trust: PreToolUse/SessionStart/etc. only fire for
    // *trusted* hooks; without this flag codex silently skips Tower's hooks (so the
    // AskUserQuestion hard-block would never run). Global pre-subcommand flag,
    // parses for fresh and `codex resume` alike (verified on 0.142.x).
    const args: string[] = [
      "--yolo",
      "--dangerously-bypass-hook-trust",
    ];

    if (opts.extraArgs?.length) {
      args.push(...this.normalizeExtraArgs(opts.extraArgs));
    }

    if (opts.resumeSessionId) {
      // `codex [flags] resume <sessionId>` — interactive resume, no prompt appended
      args.push("resume", opts.resumeSessionId);
    } else if (opts.continueLatest) {
      // `codex [flags] resume --last`
      args.push("resume", "--last");
    } else if (opts.prompt) {
      // Fresh start: `codex [flags] "<prompt>"` (interactive TUI, prompt positional)
      args.push(opts.prompt);
    }

    const env: Record<string, string> = {
      ...(opts.envOverrides ?? {}),
    };

    const raw = this.resolveCommand();

    // On Windows, pty.spawn() uses CreateProcess which cannot execute .cmd/.bat
    // files directly — they must be wrapped with cmd.exe. Without this the
    // spawned process exits immediately (exit code 1, near-empty buffer).
    if (isWindows()) {
      const ext = path.extname(raw).toLowerCase();
      if (ext === ".cmd" || ext === ".bat" || ext === ".com") {
        const shell = process.env.ComSpec || "cmd.exe";
        const commandLine = [quoteForCmd(raw), ...args.map(quoteForCmd)].join(" ");
        return {
          command: shell,
          args: ["/d", "/s", "/c", commandLine],
          env,
        };
      }
    }

    return {
      command: raw,
      args,
      env,
    };
  }

  buildEnvOverrides(opts: {
    taskId: string;
    taskTitle: string;
    apiUrl: string;
    callbackUrl?: string;
    hasParent?: boolean;
    signalDir?: string;
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
    // PreToolUse hook state (see scripts/tower-pre-tool-hook.js).
    if (opts.hasParent) {
      env.TOWER_HAS_PARENT = "1";
    }
    if (opts.signalDir) {
      env.TOWER_SIGNAL_DIR = opts.signalDir;
    }
    return env;
  }

  // ===========================================================================
  // Hooks — METHOD: file write to ~/.codex/hooks.json + [features] flag in config.toml
  //
  // Codex CLI 0.142.x exposes no `codex hook add` subcommand (verified via
  // `codex --help`; there is only `--dangerously-bypass-hook-trust`). We write
  // hooks.json and toggle `[features] hooks=true` in config.toml — verified
  // live: codex accepts our PascalCase hooks.json and records [hooks.state].
  // (The feature key was renamed `codex_hooks` → `hooks`; ensureHooksFeatureEnabled
  // migrates old configs.) Hook entries we create are always invocations of OUR
  // scripts (pre-tool-hook.js, session-start-hook.js, post-tool-hook.js,
  // stop-hook.js) — that filename string is the marker for clean uninstall.
  // Re-check on every Codex release.
  // ===========================================================================

  async installHooks(): Promise<InstallResult> {
    try {
      const managedOnlyPolicyPath = this.getManagedOnlyHooksPolicyPath();
      if (managedOnlyPolicyPath) {
        return {
          ok: false,
          method: "file",
          detail: managedOnlyPolicyPath,
          error:
            `Codex admin policy at ${managedOnlyPolicyPath} sets ` +
            "allow_managed_hooks_only=true, so Codex ignores Tower hooks in " +
            `${this.getHooksPath()}. Add the Tower hooks to the managed policy ` +
            "or disable managed-only hooks.",
        };
      }

      const hooks = this.readHooks();
      const root = getPackageRoot().replace(/\\/g, "/");
      const sessionStart = path.join(root, "scripts", "tower-session-start-hook.js").replace(/\\/g, "/");
      const preTool = path.join(root, "scripts", "tower-pre-tool-hook.js").replace(/\\/g, "/");
      const postTool = path.join(root, "scripts", "tower-post-tool-hook.js").replace(/\\/g, "/");
      const stop = path.join(root, "scripts", "tower-stop-hook.js").replace(/\\/g, "/");
      let changed = false;

      changed = this.upsertHook(hooks, "SessionStart", "session-start-hook.js", {
        hooks: [{ command: `node "${sessionStart}"`, timeout: 5, type: "command" }],
      }) || changed;

      // PreToolUse — hard-block the native interactive-question menu on unwatched
      // terminals. Codex names this tool `request_user_input` (verified live),
      // unlike Claude's `AskUserQuestion`.
      changed = this.upsertHook(hooks, "PreToolUse", "pre-tool-hook.js", {
        hooks: [{ command: `node "${preTool}"`, timeout: 5, type: "command" }],
        matcher: "request_user_input",
      }) || changed;

      changed = this.upsertHook(hooks, "PostToolUse", "post-tool-hook.js", {
        hooks: [{ command: `node "${postTool}"`, timeout: 10, type: "command" }],
        matcher: "Write|Edit|MultiEdit",
      }) || changed;

      changed = this.upsertHook(hooks, "Stop", "stop-hook.js", {
        hooks: [{ command: `node "${stop}"`, timeout: 5, type: "command" }],
      }) || changed;

      if (changed) this.writeHooks(hooks);
      // Config may have been reset independently of hooks.json (for example by
      // reinstalling Codex). Always reassert the feature flag.
      this.ensureHooksFeatureEnabled();
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
      // [event, matchName(短名 marker，匹配旧+新), wantedName(tower- 前缀新名)]
      // —— 短名 includes 让老用户 settings.json 里的旧 entry 自动迁移到新名（幂等）。
      const map: Array<[string, string, string]> = [
        ["SessionStart", "session-start-hook.js", "tower-session-start-hook.js"],
        ["PreToolUse", "pre-tool-hook.js", "tower-pre-tool-hook.js"],
        ["PostToolUse", "post-tool-hook.js", "tower-post-tool-hook.js"],
        ["Stop", "stop-hook.js", "tower-stop-hook.js"],
      ];
      let changed = false;
      for (const [event, matchName, wantedName] of map) {
        const entries = this.getHookArray(hooks, event);
        const idx = entries.findIndex((e) =>
          e?.hooks?.some?.((h: { command?: string }) => h.command?.includes(matchName))
        );
        if (idx < 0) continue;
        const wantedPath = path.join(root, "scripts", wantedName).replace(/\\/g, "/");
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
      const hookFiles = ["session-start-hook.js", "pre-tool-hook.js", "post-tool-hook.js", "stop-hook.js"];

      for (const event of ["SessionStart", "PreToolUse", "PostToolUse", "Stop"]) {
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
    if (this.getManagedOnlyHooksPolicyPath()) return false;

    const hooks = this.readHooks();
    const required: Array<[string, string]> = [
      ["SessionStart", "session-start-hook.js"],
      ["PreToolUse", "pre-tool-hook.js"],
      ["PostToolUse", "post-tool-hook.js"],
      ["Stop", "stop-hook.js"],
    ];
    return required.every(([event, filename]) =>
      this.hasHook(this.getHookArray(hooks, event), filename)
    ) && this.isHooksFeatureEnabled();
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
  // Codex CLI 0.142.x supports skills via a directory
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
        if (existing.isSymbolicLink() || (isWindows() && existing.isDirectory())) {
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
      const linkType = isWindows() ? "junction" : "dir";
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
    const { resolveSpawnTarget } = await import("@/lib/platform");
    const execFileAsync = promisify(execFile);
    const target = await resolveSpawnTarget(cmd, args, { cwd });
    const { stdout } = await execFileAsync(target.command, target.args, { cwd, timeout: timeoutMs });
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

  /**
   * Codex's machine-wide requirements file can prohibit user hooks entirely.
   * Kept overridable so installation checks can be tested without reading the
   * developer machine's real administrator policy.
   */
  getManagedRequirementsPaths(): string[] {
    if (isWindows()) {
      const programData = process.env.ProgramData || "C:\\ProgramData";
      return [path.join(programData, "OpenAI", "Codex", "requirements.toml")];
    }
    return ["/etc/codex/requirements.toml"];
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

  /**
   * Tower's PTY layer was born on Claude Code, where extra system guidance is
   * passed with `--append-system-prompt`. Codex CLI has no such flag; its
   * supported one-off override is `-c developer_instructions=<toml string>`.
   */
  private normalizeExtraArgs(extraArgs: string[]): string[] {
    const passthrough: string[] = [];
    const developerInstructions: string[] = [];

    for (let i = 0; i < extraArgs.length; i += 1) {
      const arg = extraArgs[i];
      if (arg === "--append-system-prompt") {
        const value = extraArgs[i + 1];
        if (value) developerInstructions.push(value);
        i += 1;
        continue;
      }
      passthrough.push(arg);
    }

    if (developerInstructions.length > 0) {
      passthrough.unshift(
        "-c",
        `developer_instructions=${JSON.stringify(developerInstructions.join("\n\n"))}`,
      );
    }

    return passthrough;
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

  private getManagedOnlyHooksPolicyPath(): string | null {
    for (const requirementsPath of this.getManagedRequirementsPaths()) {
      try {
        const content = fs.readFileSync(requirementsPath, "utf-8");
        if (this.hasTopLevelManagedOnlyHooksPolicy(content)) return requirementsPath;
      } catch {
        // A missing or unreadable requirements file does not impose a policy
        // that Tower can verify here.
      }
    }
    return null;
  }

  private hasTopLevelManagedOnlyHooksPolicy(content: string): boolean {
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      // Once a TOML table starts, later keys belong to that table rather than
      // the document root where allow_managed_hooks_only is defined.
      if (trimmed.startsWith("[")) return false;
      if (/^allow_managed_hooks_only\s*=\s*true(?:\s*#.*)?$/i.test(trimmed)) {
        return true;
      }
    }
    return false;
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

  /**
   * Ensure `[features] hooks = true` in config.toml so hooks actually fire.
   * 0.142.5 renamed the feature (`codex_hooks` → `hooks`); migrate old configs in
   * place. `\bhooks` never matches the `hooks` inside `codex_hooks` (preceded by
   * `_`, a word char, so no boundary) — the migration replace handles that line.
   */
  private ensureHooksFeatureEnabled(): void {
    const tomlPath = this.getSettingsPath();
    let content = "";
    try { content = fs.readFileSync(tomlPath, "utf-8"); } catch { /* file may not exist */ }
    const original = content;

    // Migrate deprecated flag name.
    content = content.replace(/codex_hooks(\s*=\s*true)/g, "hooks$1");

    if (!/\bhooks\s*=\s*true/.test(content)) {
      if (/\[features\]/.test(content)) {
        content = content.replace(/\[features\]/, "[features]\nhooks = true");
      } else {
        content += "\n[features]\nhooks = true\n";
      }
    }

    if (content === original) return;

    const dir = this.getConfigDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tomlPath, content, "utf-8");
  }

  private isHooksFeatureEnabled(): boolean {
    try {
      return /\bhooks\s*=\s*true/.test(fs.readFileSync(this.getSettingsPath(), "utf-8"));
    } catch {
      return false;
    }
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
