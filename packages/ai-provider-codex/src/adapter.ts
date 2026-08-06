import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  CliPluginError,
  canonicalCliToolName,
  collectCliQueryStream,
  classifyCliQueryFailure,
  streamProcessJsonLines,
  type CliAdapter,
  type CliHostContext,
  type CliHookOptions,
  type CliHostFileSystem,
  type CliIntegrationResult,
  type CliMcpServerOptions,
  type CliProcessSpec,
  type CliQueryOptions,
  type CliQueryEvent,
  type CliQueryResult,
  type CliSessionFailure,
  type CliSessionFailureInput,
  type CliSessionOptions,
  type CliSkillOptions,
  type CliHostResources,
} from "@tower-org/ai-sdk";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const CONNECTION_ROOT_KEYS = [
  "model",
  "model_provider",
  "openai_base_url",
  "experimental_realtime_ws_base_url",
  "service_tier",
  "disable_response_storage",
  "model_context_window",
  "model_auto_compact_token_limit",
  "model_auto_compact_token_limit_scope",
  "model_reasoning_effort",
  "model_reasoning_summary",
  "model_supports_reasoning_summaries",
  "model_verbosity",
] as const;

// Never project literal credentials or command-backed auth into argv. Environment-backed
// credentials remain available through the Host's filtered provider environment.
const PROVIDER_CONNECTION_KEYS = [
  "name",
  "base_url",
  "wire_api",
  "env_key",
  "env_key_instructions",
  "env_http_headers",
  "request_max_retries",
  "requires_openai_auth",
  "stream_idle_timeout_ms",
  "stream_max_retries",
  "supports_standalone_web_search",
  "supports_websockets",
] as const;

function tomlKeySegment(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

function tomlLiteral(value: unknown): string | null {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const values = value.map(tomlLiteral);
    return values.every((entry): entry is string => entry !== null)
      ? `[${values.join(",")}]`
      : null;
  }
  return null;
}

function appendConfigOverride(args: string[], path: string[], value: unknown): void {
  const literal = tomlLiteral(value);
  if (literal !== null) {
    args.push("-c", `${path.map(tomlKeySegment).join(".")}=${literal}`);
    return;
  }
  const nested = record(value);
  if (!nested) return;
  for (const [key, entry] of Object.entries(nested)) appendConfigOverride(args, [...path, key], entry);
}

function queryFailureCode(event: Record<string, unknown>) {
  const error = record(event.error);
  const text = [event.message, error?.message, error?.code]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return classifyCliQueryFailure(text);
}

function codexTool(value: string): { server: string; tool: string } | null {
  const mcp = value.match(/^mcp__(.+?)__(.+)$/);
  if (mcp && /^[A-Za-z0-9_-]+$/.test(mcp[1]!)) return { server: mcp[1]!, tool: mcp[2]! };
  const dot = value.indexOf(".");
  const server = value.slice(0, dot);
  return dot > 0 && /^[A-Za-z0-9_-]+$/.test(server)
    ? { server, tool: value.slice(dot + 1) }
    : null;
}

function codexUsage(value: unknown) {
  const usage = record(value);
  if (!usage) return undefined;
  return {
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
    cachedInputTokens: typeof usage.cached_input_tokens === "number" ? usage.cached_input_tokens : undefined,
  };
}

interface InstallResult {
  ok: boolean;
  method: "cli" | "file" | "symlink";
  detail: string;
  error?: string;
}

interface CodexMcpServerState {
  name: string;
  enabled: boolean;
  transport?: {
    type: "stdio";
    command: string;
    args: string[];
    cwd?: string;
    env: Record<string, string>;
    envVars: string[];
  };
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
    inspect: async (options: CliMcpServerOptions) => this.inspectMcpConnection(options),
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
      startsAtInputBoundary: opts.mode.type !== "fresh" || !opts.prompt,
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
    const result = await collectCliQueryStream(this.stream(options));
    if (!result.text?.trim() && !result.toolCalls?.length && !result.toolResults?.length) {
      throw new CliPluginError("NO_OUTPUT", "Codex query returned no output");
    }
    return result;
  }

  async *stream(options: CliQueryOptions): AsyncIterable<CliQueryEvent> {
    const args = [
      "exec", "--ignore-user-config", "--json", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral",
      "--disable", "shell_tool",
      "--disable", "unified_exec",
      "--disable", "web_search",
      "--disable", "search_tool",
      "-c", 'approval_policy="never"',
      ...this.connectionConfigArgs(),
    ];
    if (options.systemPrompt) args.push("-c", `developer_instructions=${JSON.stringify(options.systemPrompt)}`);
    if (options.model) args.push("--model", options.model);
    if (options.effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(options.effort)}`);
    for (const attachment of options.attachments ?? []) args.push("--image", attachment.path);
    const allowed = options.allowedTools?.length
      ? (options.tools ?? options.allowedTools).filter((tool) => options.allowedTools!.includes(tool))
      : options.tools ?? [];
    const byServer = new Map<string, string[]>();
    for (const value of allowed) {
      const parsed = codexTool(value);
      if (!parsed) continue;
      const tools = byServer.get(parsed.server) ?? [];
      tools.push(parsed.tool);
      byServer.set(parsed.server, tools);
    }
    const mcpEnvPatch: Record<string, string> = {};
    for (const [serverName, tools] of byServer) {
      const server = await this.queryMcpServer(serverName, options);
      if (!server.enabled || !server.transport) {
        throw new CliPluginError("TOOLING_UNAVAILABLE", "The requested Codex MCP server is unavailable");
      }
      const prefix = `mcp_servers.${serverName}`;
      args.push("-c", `${prefix}.command=${JSON.stringify(server.transport.command)}`);
      args.push("-c", `${prefix}.args=${JSON.stringify(server.transport.args)}`);
      if (server.transport.cwd) args.push("-c", `${prefix}.cwd=${JSON.stringify(server.transport.cwd)}`);
      const envVars = new Set(server.transport.envVars);
      for (const [key, value] of Object.entries(server.transport.env)) {
        const existing = mcpEnvPatch[key];
        if (existing !== undefined && existing !== value) {
          throw new CliPluginError("TOOLING_UNAVAILABLE", "Codex MCP environment variables conflict");
        }
        mcpEnvPatch[key] = value;
        envVars.add(key);
      }
      if (envVars.size > 0) args.push("-c", `${prefix}.env_vars=${JSON.stringify([...envVars])}`);
      args.push("-c", `${prefix}.enabled=true`);
      args.push("-c", `${prefix}.enabled_tools=${JSON.stringify(tools)}`);
    }
    args.push(options.prompt);
    let sawError = false;
    let sawFinish = false;
    const startedTools = new Set<string>();
    for await (const line of streamProcessJsonLines(
      this.host.process,
      { command: this.command(), args, cwd: options.cwd, envPatch: mcpEnvPatch },
      {
        signal: options.signal ?? this.host.signal,
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
      },
    )) {
      if (line.type === "malformed") continue;
      if (line.type === "exit") {
        if (line.exitCode !== 0 && !sawError) {
          yield { type: "error", error: { code: classifyCliQueryFailure(line.stderr), message: "Codex query failed" } };
        } else if (line.exitCode === 0 && !sawFinish) {
          yield { type: "finish", reason: "stop" };
        }
        continue;
      }
      const event = record(line.value);
      if (!event) continue;
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        yield { type: "session", sessionId: event.thread_id };
        continue;
      }
      if (event.type === "turn.completed") {
        const usage = codexUsage(event.usage);
        if (usage) yield { type: "usage", usage };
        sawFinish = true;
        yield { type: "finish", reason: "stop" };
        continue;
      }
      if (event.type === "turn.failed" || event.type === "error") {
        sawError = true;
        yield { type: "error", error: { code: queryFailureCode(event), message: "Codex query failed" } };
        continue;
      }
      if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") continue;
      const item = record(event.item);
      if (!item) continue;
      const id = typeof item.id === "string" ? item.id : undefined;
      if (item.type === "agent_message" && typeof item.text === "string" && event.type === "item.completed") {
        yield { type: "text", text: item.text };
      } else if (item.type === "reasoning" && event.type === "item.completed") {
        const text = typeof item.text === "string"
          ? item.text
          : Array.isArray(item.summary) ? item.summary.filter((part): part is string => typeof part === "string").join("\n") : "";
        if (text) yield { type: "reasoning", text };
      } else if (item.type === "mcp_tool_call") {
        if (!id) continue;
        const server = typeof item.server === "string" ? item.server : "mcp";
        const tool = typeof item.tool === "string" ? item.tool : "unknown";
        const name = canonicalCliToolName(`${server}.${tool}`, allowed);
        if (!startedTools.has(id)) {
          startedTools.add(id);
          yield { type: "tool-call", toolCall: { id, name, input: item.arguments ?? item.input } };
        }
        if (event.type === "item.completed") {
          const failed = item.status === "failed" || item.error !== undefined;
          yield {
            type: "tool-result",
            toolResult: {
              id,
              name,
              output: item.result,
              ...(failed ? { error: { code: "TOOL_ERROR", message: "Codex tool execution failed" } } : {}),
            },
          };
        }
      }
    }
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
          this.removeCodexTurnNotifier();
          return {
            ok: true,
            method: "file",
            detail: `${managedOnlyPolicyPath} (managed Tower hooks active)`,
          };
        }

        // `--dangerously-bypass-hook-trust` cannot override managed-only source
        // filtering. Do not silently fall back to Codex's global notify setting:
        // Tower completion is owned by Stop hooks, and transcript recovery covers
        // a missed callback without adding a second event producer.
        this.removeCodexTurnNotifier();
        return {
          ok: false,
          method: "file",
          detail: this.getHooksPath(),
          error: `Codex allows managed hooks only, but Tower managed hooks are missing from ${managedOnlyPolicyPath}`,
        };
      }

      this.removeCodexTurnNotifier();
      return {
        ok: true,
        method: "file",
        detail: `${this.getHooksPath()} (Stop hook active)`,
      };
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
   * current `TOWER_PACKAGE_ROOT`; never adds new hook entries. It also restores
   * and removes Tower's legacy global notify adapter while preserving any user
   * notifier that it previously chained.
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
      this.removeCodexTurnNotifier();
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
      this.removeCodexTurnNotifier();
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
    if (managedOnlyPolicyPath && this.hasManagedTowerHooks(managedOnlyPolicyPath)) {
      return true;
    }

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
    return hooksInstalled;
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
    return (await this.inspectMcpConnection({ ...opts, name })).installed;
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

  private async inspectMcpConnection(options: CliMcpServerOptions) {
    try {
      const signal = options.signal ?? this.host.signal;
      const timeoutMs = Math.min(options.timeoutMs ?? 5_000, 5_000);
      const server = await this.getMcpServer(options.name, options.cwd, signal, timeoutMs);
      if (!server.enabled) return { installed: true, status: "pending" as const };
      const connected = await this.host.process.probeMcpServer?.({
        name: server.name,
        cwd: options.cwd,
        signal,
        timeoutMs,
      }) ?? false;
      return { installed: true, status: connected ? "connected" as const : "disconnected" as const };
    } catch (error) {
      if (error instanceof CliPluginError
        && (error.code === "PROCESS_TIMEOUT" || error.code === "PROCESS_CANCELLED")) throw error;
      return { installed: false, status: "disconnected" as const };
    }
  }

  private connectionConfigArgs(): string[] {
    let config: Record<string, unknown>;
    try {
      config = record(parseToml(this.fs.readFileSync(this.getSettingsPath(), "utf-8"))) ?? {};
    } catch {
      throw new CliPluginError("INVALID_REQUEST", "Codex provider configuration could not be read");
    }

    const args: string[] = [];
    for (const key of CONNECTION_ROOT_KEYS) appendConfigOverride(args, [key], config[key]);

    const providerId = typeof config.model_provider === "string" ? config.model_provider : null;
    const providers = record(config.model_providers);
    const provider = providerId && providers ? record(providers[providerId]) : null;
    if (providerId && provider) {
      for (const key of PROVIDER_CONNECTION_KEYS) {
        appendConfigOverride(args, ["model_providers", providerId, key], provider[key]);
      }
    }
    return args;
  }

  private async queryMcpServer(name: string, options: CliQueryOptions): Promise<CodexMcpServerState> {
    const supplied = options.mcpServers?.find((server) => server.name === name);
    if (supplied) {
      if (!supplied.command?.trim()) {
        throw new CliPluginError("TOOLING_UNAVAILABLE", "Codex MCP request configuration is unavailable");
      }
      return {
        name,
        enabled: true,
        transport: {
          type: "stdio",
          command: supplied.command,
          args: supplied.args ?? [],
          ...(supplied.cwd ? { cwd: supplied.cwd } : {}),
          env: supplied.env ?? {},
          envVars: supplied.envVars ?? [],
        },
      };
    }
    return this.getMcpServer(
      name,
      options.cwd,
      options.signal,
      Math.min(options.timeoutMs ?? 5_000, 5_000),
    );
  }

  private async getMcpServer(
    name: string,
    cwd?: string,
    signal?: AbortSignal,
    timeoutMs = 5_000,
  ): Promise<CodexMcpServerState> {
    const result = await this.host.process.execute(
      { command: this.command(), args: ["mcp", "get", name, "--json"], cwd },
      { timeoutMs, signal: signal ?? this.host.signal, maxOutputBytes: 256 * 1024 },
    );
    if (result.exitCode !== 0) {
      throw new CliPluginError("TOOLING_UNAVAILABLE", "Codex MCP configuration is unavailable");
    }
    try {
      const parsed = JSON.parse(result.stdout) as unknown;
      const server = record(parsed);
      if (server?.name !== name) throw new Error("invalid MCP server");
      const transport = record(server.transport);
      if (transport?.type !== "stdio") return { name, enabled: server.enabled === true };
      if (typeof transport.command !== "string" || transport.command.length === 0) {
        throw new Error("invalid MCP transport");
      }
      if (transport.args !== undefined
        && (!Array.isArray(transport.args) || transport.args.some((value) => typeof value !== "string"))) {
        throw new Error("invalid MCP arguments");
      }
      const configuredEnv = record(transport.env);
      if (transport.env !== undefined && !configuredEnv) throw new Error("invalid MCP environment");
      const env = Object.fromEntries(Object.entries(configuredEnv ?? {}).map(([key, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string") {
          throw new Error("invalid MCP environment");
        }
        return [key, value];
      }));
      if (transport.env_vars !== undefined
        && (!Array.isArray(transport.env_vars)
          || transport.env_vars.some((value) => typeof value !== "string"
            || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)))) {
        throw new Error("invalid MCP environment allowlist");
      }
      return {
        name,
        enabled: server.enabled === true,
        transport: {
          type: "stdio",
          command: transport.command,
          args: transport.args as string[] | undefined ?? [],
          ...(typeof transport.cwd === "string" ? { cwd: transport.cwd } : {}),
          env,
          envVars: transport.env_vars as string[] | undefined ?? [],
        },
      };
    } catch {
      throw new CliPluginError("TOOLING_UNAVAILABLE", "Codex MCP configuration is unavailable");
    }
  }

  async models() {
    return CODEX_MODELS.map((id) => ({ id }));
  }

  getConfigDir(): string {
    return this.host.resources.providerConfigDir ?? path.join(this.host.resources.homeDir, ".codex");
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

  private removeCodexTurnNotifier(): void {
    const existing = this.readTopLevelNotify();
    if (!existing?.some((part) => part.includes("tower-codex-notify.js"))) return;
    const chain = this.decodeNotifyChain(existing);
    this.writeTopLevelNotify(chain.length > 0 ? chain : null);
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
