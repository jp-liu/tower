import * as path from "node:path";
import {
  CliPluginError,
  classifyCliQueryFailure,
  type CliAdapter,
  type CliHostContext,
  type CliHookOptions,
  type CliHostFileSystem,
  type CliIntegrationResult,
  type CliMcpServerOptions,
  type CliProcessSpec,
  type CliQueryOptions,
  type CliQueryResult,
  type CliSessionFailure,
  type CliSessionFailureInput,
  type CliSessionOptions,
  type CliSkillOptions,
  type CliHostResources,
} from "@tower/ai-sdk";

interface InstallResult {
  ok: boolean;
  method: "cli" | "file" | "symlink";
  detail: string;
  error?: string;
}

type McpInstallOptions = CliMcpServerOptions;
type McpServerConfig = Required<Pick<CliMcpServerOptions, "name" | "command" | "args">>
  & Pick<CliMcpServerOptions, "env" | "envVars">;

// Model list intentionally empty: concrete Codex model names are version-,
// rollout- and account-dependent (o3 -> gpt-5.x churn), and the capability
// resolver only validates `model` when this list is non-empty. Empty = let the
// user's ~/.codex account default win and skip false "model not available"
// errors. Surface real models in the UI later by reading ~/.codex/models_cache.json.
const CODEX_MODELS: string[] = [];

function integrationResult(result: InstallResult, installed: boolean): CliIntegrationResult {
  if (!result.ok) throw new CliPluginError("INTEGRATION_FAILED", result.error ?? result.detail);
  return { installed, changed: !/already/.test(result.detail), detail: result.detail };
}

type ProviderHost = CliHostContext & {
  fileSystem: CliHostFileSystem;
  resources: CliHostResources;
};

function requireProviderHost(host: CliHostContext): ProviderHost {
  if (!host.fileSystem || !host.resources) {
    throw new CliPluginError("UNSUPPORTED_CAPABILITY", "Codex provider requires Host fileSystem and resources");
  }
  return host as ProviderHost;
}

export class CodexCliAdapter implements CliAdapter {
  private readonly fs;
  private readonly host: ProviderHost;

  constructor(host: CliHostContext) {
    this.host = requireProviderHost(host);
    this.fs = {
      existsSync: (filePath: string) => this.host.fileSystem.exists(filePath),
      mkdirSync: (directory: string, options?: { recursive?: boolean }) => this.host.fileSystem.mkdir(directory, options),
      readFileSync: (filePath: string, encoding?: string) => {
        void encoding;
        return this.host.fileSystem.readText(filePath);
      },
      writeFileSync: (filePath: string, contents: string, encoding?: string) => {
        void encoding;
        this.host.fileSystem.writeText(filePath, contents);
      },
      promises: {
        lstat: (filePath: string) => this.host.fileSystem.lstat(filePath).then((stat) => {
          if (!stat) throw new Error(`Path does not exist: ${filePath}`);
          return stat;
        }),
        readlink: (filePath: string) => this.host.fileSystem.readLink(filePath),
        symlink: (target: string, filePath: string, type?: "dir" | "junction") =>
          this.host.fileSystem.symlink(target, filePath, type),
        unlink: (filePath: string) => this.host.fileSystem.unlink(filePath),
      },
    };
  }

  readonly hooks = {
    inspect: async () => ({ installed: await this.isHooksInstalled() }),
    install: async (options: CliHookOptions) => {
      if (options.repairOnly) {
        await this.repairHookPaths();
        return { installed: await this.isHooksInstalled(), changed: false, detail: "Codex hook paths checked" };
      }
      return integrationResult(await this.installHooks(), true);
    },
    uninstall: async () => integrationResult(await this.uninstallHooks(), false),
  };

  readonly mcp = {
    inspect: async (options: CliMcpServerOptions) => ({
      installed: await this.isMcpInstalled(options.name, options),
    }),
    install: async (options: CliMcpServerOptions) => {
      if (!options.command) throw new CliPluginError("INTEGRATION_FAILED", "MCP command is required");
      return integrationResult(await this.installMcp({
        name: options.name,
        command: options.command,
        args: options.args ?? [],
        env: options.env,
        envVars: options.envVars,
      }, options), true);
    },
    uninstall: async (options: CliMcpServerOptions) =>
      integrationResult(await this.uninstallMcp(options.name, options), false),
  };

  readonly skills = {
    inspect: async (options: CliSkillOptions) => ({
      installed: await this.isSkillInstalled(options.name, options.sourceDir),
    }),
    install: async (options: CliSkillOptions) => {
      if (!options.sourceDir) throw new CliPluginError("INTEGRATION_FAILED", "Skill sourceDir is required");
      return integrationResult(await this.installSkill(options.name, options.sourceDir), true);
    },
    uninstall: async (options: CliSkillOptions) =>
      integrationResult(await this.uninstallSkill(options.name), false),
  };

  buildSessionProcess(opts: CliSessionOptions): CliProcessSpec {
    // Match the Claude Provider contract: the autonomy flag and any
    // extraArgs (e.g. --model) must apply to fresh AND resumed sessions, so they
    // go first -- before the fresh/resume/continue branch. Verified on codex-cli
    // 0.145.x accepts the explicit full-access flag both globally and before
    // `resume`; keeping it first applies one policy to every session mode.
    // --dangerously-bypass-hook-trust: PreToolUse/SessionStart/etc. only fire for
    // *trusted* hooks; without this flag codex silently skips Tower's hooks (so the
    // AskUserQuestion hard-block would never run). Global pre-subcommand flag,
    // parses for fresh and `codex resume` alike (verified on 0.142.x).
    const args: string[] = [
      "--dangerously-bypass-approvals-and-sandbox",
      "--dangerously-bypass-hook-trust",
    ];

    if (opts.systemPrompt) {
      args.push("-c", `developer_instructions=${JSON.stringify(opts.systemPrompt)}`);
    }
    if (opts.model) args.push("--model", opts.model);
    if (opts.extraArgs?.length) args.push(...opts.extraArgs);

    if (opts.mode.type === "resume") {
      // `codex [flags] resume <sessionId>` -- interactive resume, no prompt appended
      args.push("resume", opts.mode.sessionId);
    } else if (opts.mode.type === "continue") {
      // `codex [flags] resume --last`
      args.push("resume", "--last");
    } else if (opts.prompt) {
      // Fresh start: `codex [flags] "<prompt>"` (interactive TUI, prompt positional)
      args.push(opts.prompt);
    }

    return {
      command: this.command(),
      args,
      cwd: opts.cwd,
      envPatch: opts.envPatch,
    };
  }

  buildHelloProbe(options: { command: string; cwd: string; prompt: string }): CliProcessSpec {
    return { command: options.command, args: ["exec", options.prompt], cwd: options.cwd };
  }

  classifySessionFailure(input: CliSessionFailureInput): CliSessionFailure {
    const missing = /session (?:id )?.*(?:not found|does not exist)|unknown session|no rollout found/i.test(input.output);
    return missing
      ? { code: "SESSION_NOT_FOUND", retryableWithFresh: true, diagnostic: "Codex session was not found" }
      : { code: "UNKNOWN", retryableWithFresh: false };
  }

  async generate(options: CliQueryOptions): Promise<CliQueryResult> {
    const args = ["exec"];
    if (options.systemPrompt) args.push("-c", `developer_instructions=${JSON.stringify(options.systemPrompt)}`);
    if (options.model) args.push("--model", options.model);
    args.push(options.prompt);
    const result = await this.host.process.execute({ command: this.command(), args, cwd: options.cwd }, {
      signal: options.signal ?? this.host.signal,
      maxOutputBytes: options.maxOutputBytes,
    });
    if (result.exitCode !== 0) {
      throw new CliPluginError(classifyCliQueryFailure(`${result.stderr}\n${result.stdout}`), "Codex query failed");
    }
    const text = result.stdout.trim();
    if (!text) throw new CliPluginError("NO_OUTPUT", "Codex query returned no output");
    return { text };
  }

  // ===========================================================================
  // Hooks -- METHOD: file write to ~/.codex/hooks.json + [features] flag in config.toml
  //
  // Codex CLI 0.142.x exposes no `codex hook add` subcommand (verified via
  // `codex --help`; there is only `--dangerously-bypass-hook-trust`). We write
  // hooks.json and toggle `[features] hooks=true` in config.toml -- verified
  // live: codex accepts our PascalCase hooks.json and records [hooks.state].
  // (The feature key was renamed `codex_hooks` -> `hooks`; ensureHooksFeatureEnabled
  // migrates old configs.) Hook entries we create are always invocations of OUR
  // scripts (pre-tool-hook.js, session-start-hook.js, post-tool-hook.js,
  // stop-hook.js) -- that filename string is the marker for clean uninstall.
  // Re-check on every Codex release.
  // ===========================================================================

  async installHooks(): Promise<InstallResult> {
    try {
      const managedOnlyPolicyPath = this.getManagedOnlyHooksPolicyPath();

      const hooks = this.readHooks();
      const root = this.packageRoot().replace(/\\/g, "/");
      const sessionStart = path.join(root, "scripts", "tower-session-start-hook.js").replace(/\\/g, "/");
      const preTool = path.join(root, "scripts", "tower-pre-tool-hook.js").replace(/\\/g, "/");
      const postTool = path.join(root, "scripts", "tower-post-tool-hook.js").replace(/\\/g, "/");
      const stop = path.join(root, "scripts", "tower-stop-hook.js").replace(/\\/g, "/");
      let changed = false;

      changed = this.upsertHook(hooks, "SessionStart", "session-start-hook.js", {
        hooks: [{ command: `node "${sessionStart}"`, timeout: 5, type: "command" }],
      }) || changed;

      // PreToolUse -- hard-block the native interactive-question menu on unwatched
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

      if (managedOnlyPolicyPath) {
        if (this.hasManagedTowerHooks(managedOnlyPolicyPath)) {
          this.removeCodexNotifyFallback();
          return {
            ok: true,
            method: "file",
            detail: `${managedOnlyPolicyPath} (managed Tower hooks active)`,
          };
        }

        // `--dangerously-bypass-hook-trust` cannot override managed-only source
        // filtering. Keep notify only as the completion fallback for this
        // enterprise-policy case.
        this.ensureCodexNotifyFallback();
        return {
          ok: true,
          method: "file",
          detail:
            `${this.getHooksPath()} (turn-complete notify fallback active; ` +
            `managed hooks policy: ${managedOnlyPolicyPath})`,
        };
      }

      // Tower-launched Codex sessions pass --dangerously-bypass-hook-trust, so
      // these hooks run immediately on first install. Remove a prior managed
      // fallback to prevent duplicate Stop callbacks.
      this.removeCodexNotifyFallback();
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
   * Repair stale Tower hook paths in-place -- `~/.codex/hooks.toml` may still
   * contain entries that 0.2.5/0.2.6 wrote with broken paths under
   * `.next/standalone/scripts/`. Rewrite ONLY existing entries to the
   * current `TOWER_PACKAGE_ROOT`; never adds new ones.
   */
  async repairHookPaths(): Promise<void> {
    try {
      const hooks = this.readHooks();
      const root = this.packageRoot().replace(/\\/g, "/");
      // The short marker matches both legacy and tower-prefixed hook names, so
      // the next repair migrates old settings entries idempotently.
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
      // Best-effort -- never throw out of a repair call.
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
      this.removeCodexNotifyFallback();
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
    const managedOnlyPolicyPath = this.getManagedOnlyHooksPolicyPath();
    if (managedOnlyPolicyPath && this.hasManagedTowerHooks(managedOnlyPolicyPath)) return true;

    const hooks = this.readHooks();
    const required: Array<[string, string]> = [
      ["SessionStart", "session-start-hook.js"],
      ["PreToolUse", "pre-tool-hook.js"],
      ["PostToolUse", "post-tool-hook.js"],
      ["Stop", "stop-hook.js"],
    ];
    const hooksInstalled = required.every(([event, filename]) =>
      this.hasHook(this.getHookArray(hooks, event), filename)
    ) && this.isHooksFeatureEnabled();
    if (!hooksInstalled) return false;
    return !managedOnlyPolicyPath || this.isCodexNotifyFallbackInstalled();
  }

  // ===========================================================================
  // MCP -- METHOD: CLI (`codex mcp add` / `codex mcp remove` / `codex mcp get`)
  //
  // codex mcp add <name> [--env K=V ...] -- <command> <args...>
  // The `-c, --config` global flag is NOT used here -- installs go into the
  // default user config (~/.codex/config.toml). Project-scope is not currently
  // supported by Codex MCP, so opts.scope is informational only.
  // ===========================================================================

  async installMcp(server: McpServerConfig, opts: McpInstallOptions): Promise<InstallResult> {
    const cmd = this.command();
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
      this.ensureMcpEnvVars(server.name, server.envVars ?? []);
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

  async uninstallMcp(name: string, opts: McpInstallOptions): Promise<InstallResult> {
    const cmd = this.command();
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

  async isMcpInstalled(name: string, opts: McpInstallOptions): Promise<boolean> {
    const cmd = this.command();
    try {
      await this.runCli(cmd, ["mcp", "get", name], opts.cwd, 5000);
      if (name === "tower" || name.startsWith("tower-")) {
        return this.hasMcpEnvVars(name, opts.envVars ?? []);
      }
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Skills -- METHOD: symlink to ~/.codex/skills/<name>
  //
  // Codex CLI 0.142.x supports skills via a directory
  // scan of $CODEX_HOME/skills (default ~/.codex/skills). No `codex skill add`
  // command exists. We symlink so source edits in <repo>/skills propagate, and
  // we can safely identify our installs (lstat -> isSymbolicLink + readlink).
  // ===========================================================================

  async installSkill(skillName: string, sourceDir: string): Promise<InstallResult> {
    const target = path.join(this.getConfigDir(), "skills", skillName);
    try {
      if (!this.fs.existsSync(sourceDir)) {
        return {
          ok: false,
          method: "symlink",
          detail: target,
          error: `Source skill dir does not exist: ${sourceDir}`,
        };
      }
      this.fs.mkdirSync(path.dirname(target), { recursive: true });

      const existing = await this.fs.promises.lstat(target).catch(() => null);
      if (existing) {
        // Windows junctions show up as both `isSymbolicLink` and `isDirectory`,
        // so accept either form when checking for a link we own.
        if (existing.isSymbolicLink() || (this.host.platform === "win32" && existing.isDirectory())) {
          try {
            const current = await this.fs.promises.readlink(target);
            if (path.resolve(current) === path.resolve(sourceDir)) {
              return { ok: true, method: "symlink", detail: `${target} -> ${sourceDir} (already)` };
            }
            await this.fs.promises.unlink(target);
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
      const linkType = this.host.platform === "win32" ? "junction" : "dir";
      await this.fs.promises.symlink(sourceDir, target, linkType);
      return { ok: true, method: "symlink", detail: `${target} -> ${sourceDir}` };
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
      const stat = await this.fs.promises.lstat(target).catch(() => null);
      if (!stat) return { ok: true, method: "symlink", detail: `${target} (already absent)` };
      if (!stat.isSymbolicLink()) {
        return {
          ok: false,
          method: "symlink",
          detail: target,
          error: `Refusing to remove non-symlink at ${target}`,
        };
      }
      await this.fs.promises.unlink(target);
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
      const stat = await this.fs.promises.lstat(target);
      if (!stat.isSymbolicLink()) return false;
      if (!expectedSourceDir) return true;
      const current = await this.fs.promises.readlink(target);
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
    const result = await this.host.process.execute({ command: cmd, args, cwd }, {
      timeoutMs,
      signal: this.host.signal,
    });
    if (result.exitCode !== 0) {
      throw new CliPluginError("INTEGRATION_FAILED", `Codex CLI exited with code ${result.exitCode ?? "signal"}`);
    }
    return result.stdout;
  }

  async models() {
    return CODEX_MODELS.map((id) => ({ id }));
  }

  getConfigDir(): string {
    return this.host.resources.providerConfigDir;
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
    return this.host.resources.managedConfigPaths ?? [];
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

  private command(): string {
    return this.host.resources.commandPath ?? "codex";
  }

  private packageRoot(): string {
    const root = this.host.resources.towerPackageRoot;
    if (!root) throw new CliPluginError("INTEGRATION_FAILED", "Tower package root is not available");
    return root;
  }

  // -- hooks.json helpers ---------------------------------------------------

  private getHooksPath(): string {
    return path.join(this.getConfigDir(), "hooks.json");
  }

  private ensureMcpEnvVars(serverName: string, envVars: string[]): void {
    if (envVars.length === 0) return;
    const configPath = this.getSettingsPath();
    const content = this.fs.readFileSync(configPath, "utf-8");
    const lines = content.split(/\r?\n/);
    const heading = `[mcp_servers.${serverName}]`;
    const start = lines.findIndex((line) => line.trim() === heading);
    if (start < 0) {
      throw new Error(`Codex MCP config section not found after install: ${heading}`);
    }

    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (lines[i].trim().startsWith("[")) {
        end = i;
        break;
      }
    }

    const value = `env_vars = ${JSON.stringify([...new Set(envVars)].sort())}`;
    const existing = lines.findIndex(
      (line, index) => index > start && index < end && /^\s*env_vars\s*=/.test(line),
    );
    if (existing >= 0) lines[existing] = value;
    else lines.splice(end, 0, value);

    this.fs.writeFileSync(configPath, lines.join("\n"), "utf-8");
  }

  private hasMcpEnvVars(serverName: string, required: string[]): boolean {
    try {
      const lines = this.fs.readFileSync(this.getSettingsPath(), "utf-8").split(/\r?\n/);
      const heading = `[mcp_servers.${serverName}]`;
      const start = lines.findIndex((line) => line.trim() === heading);
      if (start < 0) return false;
      for (let i = start + 1; i < lines.length; i += 1) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith("[")) break;
        const match = trimmed.match(/^env_vars\s*=\s*(\[.*\])\s*$/);
        if (!match) continue;
        const configured = JSON.parse(match[1]) as unknown;
        return Array.isArray(configured) && required.every((name) => configured.includes(name));
      }
    } catch {
      return false;
    }
    return false;
  }

  private getManagedOnlyHooksPolicyPath(): string | null {
    for (const requirementsPath of this.getManagedRequirementsPaths()) {
      try {
        const content = this.fs.readFileSync(requirementsPath, "utf-8");
        if (this.hasTopLevelManagedOnlyHooksPolicy(content)) return requirementsPath;
      } catch {
        // A missing or unreadable requirements file does not impose a policy
        // that Tower can verify here.
      }
    }
    return null;
  }

  private hasManagedTowerHooks(requirementsPath: string): boolean {
    try {
      const content = this.fs.readFileSync(requirementsPath, "utf-8");
      const markerStart = content.indexOf("# --- Tower managed hooks (BEGIN) ---");
      const markerEnd = content.indexOf("# --- Tower managed hooks (END) ---");
      if (markerStart < 0 || markerEnd <= markerStart) return false;
      const block = content.slice(markerStart, markerEnd);
      return [
        "tower-session-start-hook.js",
        "tower-pre-tool-hook.js",
        "tower-post-tool-hook.js",
        "tower-stop-hook.js",
      ].every((filename) => block.includes(filename));
    } catch {
      return false;
    }
  }

  private getCodexNotifyScriptPath(): string {
    return path
      .join(this.packageRoot(), "scripts", "tower-codex-notify.js")
      .replace(/\\/g, "/");
  }

  private ensureCodexNotifyFallback(): void {
    const existing = this.readTopLevelNotify();
    const scriptPath = this.getCodexNotifyScriptPath();
    let chain: string[] = [];

    if (existing?.some((part) => part.includes("tower-codex-notify.js"))) {
      chain = this.decodeNotifyChain(existing);
    } else if (existing) {
      chain = existing;
    }

    const notify = ["node", scriptPath];
    if (chain.length > 0) {
      notify.push(
        "--chain-base64",
        Buffer.from(JSON.stringify(chain), "utf-8").toString("base64"),
      );
    }
    this.writeTopLevelNotify(notify);
  }

  private removeCodexNotifyFallback(): void {
    const existing = this.readTopLevelNotify();
    if (!existing?.some((part) => part.includes("tower-codex-notify.js"))) return;
    const chain = this.decodeNotifyChain(existing);
    this.writeTopLevelNotify(chain.length > 0 ? chain : null);
  }

  private isCodexNotifyFallbackInstalled(): boolean {
    const existing = this.readTopLevelNotify();
    return existing?.includes(this.getCodexNotifyScriptPath()) ?? false;
  }

  private decodeNotifyChain(notify: string[]): string[] {
    const index = notify.indexOf("--chain-base64");
    if (index < 0 || !notify[index + 1]) return [];
    try {
      const parsed = JSON.parse(Buffer.from(notify[index + 1], "base64").toString("utf-8"));
      return Array.isArray(parsed) && parsed.every((part) => typeof part === "string")
        ? parsed
        : [];
    } catch {
      return [];
    }
  }

  private readTopLevelNotify(): string[] | null {
    let content = "";
    try {
      content = this.fs.readFileSync(this.getSettingsPath(), "utf-8");
    } catch {
      return null;
    }
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[")) break;
      if (!/^notify\s*=/.test(trimmed)) continue;
      const match = trimmed.match(/^notify\s*=\s*(\[.*\])\s*(?:#.*)?$/);
      if (!match) throw new Error("Unsupported multiline Codex notify configuration");
      const parsed = JSON.parse(match[1]) as unknown;
      if (!Array.isArray(parsed) || !parsed.every((part) => typeof part === "string")) {
        throw new Error("Codex notify configuration must be an argv string array");
      }
      return parsed;
    }
    return null;
  }

  private writeTopLevelNotify(notify: string[] | null): void {
    const configPath = this.getSettingsPath();
    let content = "";
    try {
      content = this.fs.readFileSync(configPath, "utf-8");
    } catch {
      // Config may not exist yet.
    }
    const lines = content.split(/\r?\n/);
    const firstTable = lines.findIndex((line) => line.trim().startsWith("["));
    const searchEnd = firstTable >= 0 ? firstTable : lines.length;
    const existing = lines.findIndex(
      (line, index) => index < searchEnd && /^\s*notify\s*=/.test(line),
    );

    if (notify) {
      const value = `notify = ${JSON.stringify(notify)}`;
      if (existing >= 0) lines[existing] = value;
      else lines.splice(searchEnd, 0, value, "");
    } else if (existing >= 0) {
      lines.splice(existing, 1);
    } else {
      return;
    }

    const dir = this.getConfigDir();
    if (!this.fs.existsSync(dir)) this.fs.mkdirSync(dir, { recursive: true });
    this.fs.writeFileSync(configPath, lines.join("\n"), "utf-8");
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
      const raw = JSON.parse(this.fs.readFileSync(this.getHooksPath(), "utf-8")) as Record<string, unknown>;
      return (raw["hooks"] as Record<string, unknown>) ?? {};
    } catch {
      return {};
    }
  }

  private writeHooks(hooks: Record<string, unknown>): void {
    const dir = this.getConfigDir();
    if (!this.fs.existsSync(dir)) this.fs.mkdirSync(dir, { recursive: true });
    this.fs.writeFileSync(this.getHooksPath(), JSON.stringify({ hooks }, null, 2), "utf-8");
  }

  /**
   * Ensure `[features] hooks = true` in config.toml so hooks actually fire.
   * 0.142.5 renamed the feature (`codex_hooks` -> `hooks`); migrate old configs in
   * place. `\bhooks` never matches the `hooks` inside `codex_hooks` (preceded by
   * `_`, a word char, so no boundary) -- the migration replace handles that line.
   */
  private ensureHooksFeatureEnabled(): void {
    const tomlPath = this.getSettingsPath();
    let content = "";
    try { content = this.fs.readFileSync(tomlPath, "utf-8"); } catch { /* file may not exist */ }
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
    if (!this.fs.existsSync(dir)) this.fs.mkdirSync(dir, { recursive: true });
    this.fs.writeFileSync(tomlPath, content, "utf-8");
  }

  private isHooksFeatureEnabled(): boolean {
    try {
      return /\bhooks\s*=\s*true/.test(this.fs.readFileSync(this.getSettingsPath(), "utf-8"));
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
