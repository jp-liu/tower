import * as path from "node:path";
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

function requestMcpConfig(servers: NonNullable<CliQueryOptions["mcpServers"]>): string {
  const mcpServers = Object.fromEntries(servers.map((server) => {
    if (!/^[A-Za-z0-9_-]+$/.test(server.name) || !server.command?.trim()) {
      throw new CliPluginError("TOOLING_UNAVAILABLE", "Claude MCP request configuration is unavailable");
    }
    return [server.name, {
      command: server.command,
      args: server.args ?? [],
      ...(server.cwd ? { cwd: server.cwd } : {}),
      ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
    }];
  }));
  return JSON.stringify({ mcpServers });
}

function claudeUsage(value: unknown) {
  const usage = record(value);
  if (!usage) return undefined;
  return {
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
    cachedInputTokens: typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : undefined,
  };
}

interface InstallResult {
  ok: boolean;
  method: "cli" | "file" | "symlink";
  detail: string;
  error?: string;
}

type McpInstallOptions = Pick<CliMcpServerOptions, "scope" | "cwd" | "signal" | "timeoutMs">;
type McpServerConfig = Required<Pick<CliMcpServerOptions, "name" | "command" | "args">>
  & Pick<CliMcpServerOptions, "env" | "envVars">;

const CLAUDE_MODELS = ["sonnet", "opus", "haiku", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];

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
    throw new CliPluginError("UNSUPPORTED_CAPABILITY", "Claude provider requires Host fileSystem and resources");
  }
  return host as ProviderHost;
}

export class ClaudeCliAdapter implements CliAdapter {
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
        return { installed: await this.isHooksInstalled(), changed: false, detail: "Claude hook paths checked" };
      }
      return integrationResult(await this.installHooks(options.apiUrl ?? ""), true);
    },
    uninstall: async () =>
      integrationResult(await this.uninstallHooks(), false),
  };

  readonly mcp = {
    inspect: async (options: CliMcpServerOptions) => this.inspectMcpConnection(options.name, options),
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
    const args: string[] = [
      "--dangerously-skip-permissions",
    ];

    if (opts.systemPrompt) args.push("--append-system-prompt", opts.systemPrompt);
    if (opts.model) args.push("--model", opts.model);
    if (opts.extraArgs?.length) {
      args.push(...opts.extraArgs);
    }

    if (opts.mode.type === "resume") {
      args.push("--resume", opts.mode.sessionId);
    } else if (opts.mode.type === "continue") {
      args.push("--continue");
    } else {
      if (opts.prompt) {
        args.push(opts.prompt);
      }
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
    return {
      command: options.command,
      args: ["--print", options.prompt, "--output-format", "stream-json", "--verbose"],
      cwd: options.cwd,
    };
  }

  classifySessionFailure(input: CliSessionFailureInput): CliSessionFailure {
    const missing = /no conversation found with session id|unknown session|session .* not found/i.test(input.output);
    return missing
      ? { code: "SESSION_NOT_FOUND", retryableWithFresh: true, diagnostic: "Claude session was not found" }
      : { code: "UNKNOWN", retryableWithFresh: false };
  }

  async generate(options: CliQueryOptions): Promise<CliQueryResult> {
    const result = await collectCliQueryStream(this.stream(options));
    if (!result.text?.trim() && !result.toolCalls?.length && !result.toolResults?.length) {
      throw new CliPluginError("NO_OUTPUT", "Claude query returned no output");
    }
    return result;
  }

  async *stream(options: CliQueryOptions): AsyncIterable<CliQueryEvent> {
    const allowed = options.allowedTools?.length
      ? (options.tools ?? options.allowedTools).filter((tool) => options.allowedTools!.includes(tool))
      : options.tools ?? [];
    const imageAttachments = options.attachments ?? [];
    const initialInput = imageAttachments.length ? `${JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: options.prompt },
          ...imageAttachments.map((attachment) => ({
            type: "image",
            source: { type: "base64", media_type: attachment.mediaType, data: attachment.dataBase64 },
          })),
        ],
      },
    })}\n` : undefined;
    const args = [
      "--print",
      ...(initialInput ? ["--input-format", "stream-json"] : [options.prompt]),
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--no-session-persistence",
      "--permission-mode", "bypassPermissions",
      "--tools", allowed.join(","),
    ];
    if (options.mcpServers?.length) {
      args.push("--mcp-config", requestMcpConfig(options.mcpServers), "--strict-mcp-config");
    }
    if (options.systemPrompt) args.push("--append-system-prompt", options.systemPrompt);
    if (options.model) args.push("--model", options.model);
    if (options.maxTurns !== undefined) args.push("--max-turns", String(options.maxTurns));
    if (options.effort) args.push("--effort", options.effort);
    if (allowed.length) args.push("--allowedTools", allowed.join(","));
    let sawError = false;
    let sawFinish = false;
    let sawTextDelta = false;
    let sawReasoningDelta = false;
    const toolNames = new Map<string, string>();
    for await (const line of streamProcessJsonLines(
      this.host.process,
      { command: this.command(), args, cwd: options.cwd, initialInput },
      {
        signal: options.signal ?? this.host.signal,
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
      },
    )) {
      if (line.type === "malformed") continue;
      if (line.type === "exit") {
        if (line.exitCode !== 0 && !sawError) {
          yield { type: "error", error: { code: classifyCliQueryFailure(line.stderr), message: "Claude query failed" } };
        } else if (line.exitCode === 0 && !sawFinish) {
          yield { type: "finish", reason: "stop" };
        }
        continue;
      }
      const event = record(line.value);
      if (!event) continue;
      if (event.type === "system" && event.subtype === "init") {
        if (typeof event.session_id === "string") yield { type: "session", sessionId: event.session_id };
        continue;
      }
      if (event.type === "stream_event") {
        const streamEvent = record(event.event);
        const delta = record(streamEvent?.delta);
        if (streamEvent?.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
          sawTextDelta = true;
          yield { type: "text", text: delta.text };
        } else if (streamEvent?.type === "content_block_delta" && delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
          sawReasoningDelta = true;
          yield { type: "reasoning", text: delta.thinking };
        }
        continue;
      }
      if (event.type === "assistant") {
        const message = record(event.message);
        const content = Array.isArray(message?.content) ? message.content : [];
        for (const rawBlock of content) {
          const block = record(rawBlock);
          if (!block) continue;
          if (block.type === "text" && !sawTextDelta && typeof block.text === "string") {
            yield { type: "text", text: block.text };
          } else if (block.type === "thinking" && !sawReasoningDelta && typeof block.thinking === "string") {
            yield { type: "reasoning", text: block.thinking };
          } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
            const name = canonicalCliToolName(block.name, allowed);
            toolNames.set(block.id, name);
            yield { type: "tool-call", toolCall: { id: block.id, name, input: block.input } };
          }
        }
        const usage = claudeUsage(message?.usage);
        if (usage) yield { type: "usage", usage };
        continue;
      }
      if (event.type === "user") {
        const message = record(event.message);
        const content = Array.isArray(message?.content) ? message.content : [];
        for (const rawBlock of content) {
          const block = record(rawBlock);
          if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
            yield {
              type: "tool-result",
              toolResult: {
                id: block.tool_use_id,
                name: toolNames.get(block.tool_use_id),
                output: block.content,
                ...(block.is_error === true ? { error: { code: "TOOL_ERROR", message: "Claude tool execution failed" } } : {}),
              },
            };
          }
        }
        continue;
      }
      if (event.type === "result") {
        if (typeof event.session_id === "string") yield { type: "session", sessionId: event.session_id };
        const usage = claudeUsage(event.usage);
        if (usage) yield { type: "usage", usage };
        if (event.is_error === true || event.subtype !== "success") {
          sawError = true;
          yield { type: "error", error: { code: "PROVIDER_FAILURE", message: "Claude query failed" } };
        } else {
          sawFinish = true;
          yield { type: "finish", reason: typeof event.stop_reason === "string" ? event.stop_reason : "stop" };
        }
      }
    }
  }

  // ===========================================================================
  // Hooks -- METHOD: file write
  //
  // Claude CLI 4.x exposes no `claude hook add` subcommand, so we have to write
  // ~/.claude/settings.json directly. We only touch hook entries whose command
  // string includes one of OUR scripts (session-start-hook.js, post-tool-hook.js,
  // stop-hook.js) -- that filename match acts as a marker for clean uninstall.
  // Re-check on every Claude release; switch to CLI as soon as it lands.
  // ===========================================================================

  async installHooks(_apiUrl: string): Promise<InstallResult> {
    void _apiUrl;
    try {
      const settings = this.readSettings();
      const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
      const root = this.packageRoot().replace(/\\/g, "/");
      const sessionStart = path.join(root, "scripts", "tower-session-start-hook.js").replace(/\\/g, "/");
      const preTool = path.join(root, "scripts", "tower-pre-tool-hook.js").replace(/\\/g, "/");
      const postTool = path.join(root, "scripts", "tower-post-tool-hook.js").replace(/\\/g, "/");
      const stop = path.join(root, "scripts", "tower-stop-hook.js").replace(/\\/g, "/");
      let changed = false;

      changed = this.upsertHook(hooks, "SessionStart", "session-start-hook.js", {
        hooks: [{ command: `node "${sessionStart}"`, timeout: 5, type: "command" }],
      }) || changed;

      // PreToolUse -- hard-block the native AskUserQuestion menu on unwatched terminals.
      changed = this.upsertHook(hooks, "PreToolUse", "pre-tool-hook.js", {
        hooks: [{ command: `node "${preTool}"`, timeout: 5, type: "command" }],
        matcher: "AskUserQuestion",
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
   * Repair stale Tower hook paths in-place -- `~/.claude/settings.json` may
   * still contain entries that 0.2.5/0.2.6 wrote with broken paths under
   * `.next/standalone/scripts/`. Rewrite ONLY existing entries to the
   * current `TOWER_PACKAGE_ROOT`; never adds new ones (the user opts into
   * hooks via Test Connection, not silently on startup).
   */
  async repairHookPaths(): Promise<void> {
    try {
      const settings = this.readSettings();
      const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
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
        settings["hooks"] = hooks;
        this.writeSettings(settings);
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
      const settings = this.readSettings();
      const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
      const hookFiles = ["session-start-hook.js", "pre-tool-hook.js", "post-tool-hook.js", "stop-hook.js"];

      for (const event of ["SessionStart", "PreToolUse", "PostToolUse", "Stop"]) {
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
    const required: Array<[string, string]> = [
      ["SessionStart", "session-start-hook.js"],
      ["PreToolUse", "pre-tool-hook.js"],
      ["PostToolUse", "post-tool-hook.js"],
      ["Stop", "stop-hook.js"],
    ];
    return required.every(([event, filename]) =>
      this.hasHook(this.getHookArray(hooks, event), filename)
    );
  }

  // ===========================================================================
  // MCP -- METHOD: CLI (`claude mcp add-json` / `claude mcp remove` / `claude mcp get`)
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
    // Claude MCP subprocesses inherit the task terminal's parent environment,
    // so McpServerConfig.envVars needs no serialized equivalent here. Codex
    // requires an explicit env_vars allow-list and handles it in its adapter.
    const cmd = this.command();
    const args = ["mcp", "add-json", "-s", scope, server.name, JSON.stringify(json)];
    try {
      // Replace any existing entry at this scope so updates land cleanly.
      await this.runCli(cmd, ["mcp", "remove", "-s", scope, server.name], opts.cwd).catch(() => {
        // Non-existent server -> claude exits non-zero. Safe to ignore.
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
    const cmd = this.command();
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
    return (await this.inspectMcpConnection(name, opts)).installed;
  }

  private async inspectMcpConnection(name: string, opts: McpInstallOptions = {}) {
    try {
      const output = await this.runCli(
        this.command(),
        ["mcp", "get", name],
        opts.cwd,
        Math.min(opts.timeoutMs ?? 5_000, 5_000),
        opts.signal,
      );
      if (/pending approval|\bpending\b/i.test(output)) {
        return { installed: true, status: "pending" as const };
      }
      if (/[✓✔]\s*connected|\bstatus:\s*(?:[✓✔]\s*)?connected\b/i.test(output)) {
        return { installed: true, status: "connected" as const };
      }
      return { installed: true, status: "disconnected" as const };
    } catch (error) {
      if (error instanceof CliPluginError
        && (error.code === "PROCESS_TIMEOUT" || error.code === "PROCESS_CANCELLED")) throw error;
      return { installed: false, status: "disconnected" as const };
    }
  }

  // ===========================================================================
  // Skills -- METHOD: symlink to ~/.claude/skills/<name>
  //
  // Claude discovers skills by directory scan; there is no `claude skill add`.
  // Symlink (vs copy) gives us:
  //   - live updates from <repo>/skills/<name>
  //   - safe ownership detection (lstat -> isSymbolicLink + readlink target check)
  //   - clean uninstall (only delete if the link still points into our repo)
  // Pattern adopted from paperclip's local-cli installer.
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
            // Not a readlink-able entry (real dir on win32) -- refuse to overwrite.
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
          // Real directory / file at target -- refuse to overwrite user data.
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
      // Claude does over `~/.claude/skills/`. POSIX always uses `dir`.
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
      // Only remove if it's our symlink -- never delete a real directory the user owns.
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
   * Run a CLI subcommand without a shell. Used for `claude mcp ...` operations.
   * Throws on non-zero exit or timeout.
   */
  private async runCli(
    cmd: string,
    args: string[],
    cwd?: string,
    timeoutMs = 10000,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await this.host.process.execute({ command: cmd, args, cwd }, {
      timeoutMs,
      signal: signal ?? this.host.signal,
    });
    if (result.exitCode !== 0) {
      throw new CliPluginError("INTEGRATION_FAILED", `Claude CLI exited with code ${result.exitCode ?? "signal"}`);
    }
    return result.stdout;
  }

  async models() {
    return CLAUDE_MODELS.map((id) => ({ id }));
  }

  getConfigDir(): string {
    return this.host.resources.providerConfigDir ?? path.join(this.host.resources.homeDir, ".claude");
  }

  getSettingsPath(): string {
    return path.join(this.getConfigDir(), "settings.json");
  }

  getSessionsDir(): string {
    return path.join(this.getConfigDir(), "projects");
  }

  private command(): string {
    return this.host.resources.commandPath ?? "claude";
  }

  private packageRoot(): string {
    const root = this.host.resources.towerPackageRoot;
    if (!root) throw new CliPluginError("INTEGRATION_FAILED", "Tower package root is not available");
    return root;
  }

  private readSettings(): Record<string, unknown> {
    try {
      return JSON.parse(this.fs.readFileSync(this.getSettingsPath(), "utf-8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private writeSettings(data: Record<string, unknown>): void {
    const dir = this.getConfigDir();
    if (!this.fs.existsSync(dir)) this.fs.mkdirSync(dir, { recursive: true });
    this.fs.writeFileSync(this.getSettingsPath(), JSON.stringify(data, null, 2), "utf-8");
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
