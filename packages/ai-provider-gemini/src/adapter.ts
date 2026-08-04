import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  CliPluginError,
  canonicalCliToolName,
  collectCliQueryStream,
  classifyCliQueryFailure,
  streamProcessJsonLines,
  type CliAdapter,
  type CliHostContext,
  type CliHostResources,
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
} from "@tower-org/ai-sdk";

type ProviderHost = CliHostContext & { resources: CliHostResources; fileSystem: CliHostFileSystem };

function requireProviderHost(host: CliHostContext): ProviderHost {
  if (!host.resources || !host.fileSystem) {
    throw new CliPluginError("UNSUPPORTED_CAPABILITY", "Gemini provider requires Host resources and fileSystem");
  }
  return host as ProviderHost;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function geminiTool(value: string): { server?: string; tool: string } {
  const claude = value.match(/^mcp__(.+?)__(.+)$/);
  if (claude) return { server: claude[1]!, tool: claude[2]! };
  const dot = value.indexOf(".");
  if (dot > 0) return { server: value.slice(0, dot), tool: value.slice(dot + 1) };
  return { tool: value };
}

function geminiUsage(value: unknown) {
  const stats = record(value);
  if (!stats) return undefined;
  const totals = record(stats.tokens) ?? stats;
  return {
    inputTokens: typeof totals.input_tokens === "number" ? totals.input_tokens
      : typeof totals.prompt === "number" ? totals.prompt : undefined,
    outputTokens: typeof totals.output_tokens === "number" ? totals.output_tokens
      : typeof totals.candidates === "number" ? totals.candidates : undefined,
    cachedInputTokens: typeof totals.cached_input_tokens === "number" ? totals.cached_input_tokens
      : typeof totals.cached === "number" ? totals.cached : undefined,
  };
}

function combinedInitialInput(systemPrompt: string | undefined, prompt: string): string {
  if (!systemPrompt) return prompt;
  return [
    `Tower system instructions (${systemPrompt.length} characters):`,
    systemPrompt,
    "",
    `User prompt (${prompt.length} characters):`,
    prompt,
  ].join("\n");
}

export class GeminiCliAdapter implements CliAdapter {
  private readonly host: ProviderHost;

  constructor(host: CliHostContext) {
    this.host = requireProviderHost(host);
  }

  readonly mcp = {
    inspect: async (options: CliMcpServerOptions) => {
      const result = await this.run(
        ["mcp", "list"],
        options.cwd,
        Math.min(options.timeoutMs ?? 5_000, 5_000),
        false,
        options.signal,
      );
      const line = result.split(/\r?\n/).find((entry) =>
        new RegExp(`(?:^|\\s)${escapeRegExp(options.name)}:`).test(entry)
      );
      if (!line) return { installed: false, status: "disconnected" as const };
      if (/\bconnected\s*$/i.test(line) && !/disconnected/i.test(line)) {
        return { installed: true, status: "connected" as const };
      }
      if (/\bconnecting\b|\bpending\b/i.test(line)) {
        return { installed: true, status: "pending" as const };
      }
      return { installed: true, status: "disconnected" as const };
    },
    install: async (options: CliMcpServerOptions): Promise<CliIntegrationResult> => {
      if (!options.command) throw new CliPluginError("INTEGRATION_FAILED", "MCP command is required");
      const scope = options.scope === "project" ? "project" : "user";
      await this.run(["mcp", "remove", "--scope", scope, options.name], options.cwd, 10_000, false);
      const args = ["mcp", "add", "--scope", scope, "--trust"];
      for (const [key, value] of Object.entries(options.env ?? {})) args.push("--env", `${key}=${value}`);
      args.push(options.name, options.command, ...(options.args ?? []));
      await this.run(args, options.cwd);
      return { installed: true, changed: true, detail: "Gemini MCP server installed" };
    },
    uninstall: async (options: CliMcpServerOptions): Promise<CliIntegrationResult> => {
      const scope = options.scope === "project" ? "project" : "user";
      await this.run(["mcp", "remove", "--scope", scope, options.name], options.cwd);
      return { installed: false, changed: true, detail: "Gemini MCP server removed" };
    },
  };

  readonly skills = {
    inspect: async (options: CliSkillOptions) => {
      const result = await this.run(["skills", "list", "--all"], undefined, 5_000, false);
      return { installed: result.includes(options.name) };
    },
    install: async (options: CliSkillOptions): Promise<CliIntegrationResult> => {
      if (!options.sourceDir) throw new CliPluginError("INTEGRATION_FAILED", "Skill sourceDir is required");
      const scope = options.scope ?? "user";
      await this.run(["skills", "install", options.sourceDir, "--scope", scope, "--consent"]);
      return { installed: true, changed: true, detail: "Gemini skill installed" };
    },
    uninstall: async (options: CliSkillOptions): Promise<CliIntegrationResult> => {
      await this.run(["skills", "uninstall", options.name, "--scope", options.scope ?? "user"]);
      return { installed: false, changed: true, detail: "Gemini skill uninstalled" };
    },
  };

  buildSessionProcess(options: CliSessionOptions): CliProcessSpec {
    const args = ["--yolo"];
    if (options.model) args.push("--model", options.model);
    if (options.extraArgs?.length) args.push(...options.extraArgs);

    let initialInput: string | undefined;
    if (options.mode.type === "resume") {
      args.push("--resume", options.mode.sessionId);
    } else if (options.mode.type === "continue") {
      args.push("--resume", "latest");
    } else {
      const combined = combinedInitialInput(options.systemPrompt, options.prompt);
      initialInput = combined || undefined;
    }

    return {
      command: this.command(),
      args,
      cwd: options.cwd,
      envPatch: options.envPatch,
      initialInput,
      startsAtInputBoundary: initialInput === undefined,
    };
  }

  buildHelloProbe(options: { command: string; cwd: string; prompt: string }): CliProcessSpec {
    return {
      command: options.command,
      args: ["--prompt", options.prompt, "--output-format", "json"],
      cwd: options.cwd,
    };
  }

  classifySessionFailure(input: CliSessionFailureInput): CliSessionFailure {
    const missing = /session .*not found|no session|invalid session|could not resume/i.test(input.output);
    return missing
      ? { code: "SESSION_NOT_FOUND", retryableWithFresh: true, diagnostic: "Gemini session was not found" }
      : { code: "UNKNOWN", retryableWithFresh: false };
  }

  async generate(options: CliQueryOptions): Promise<CliQueryResult> {
    const result = await collectCliQueryStream(this.stream(options));
    if (!result.text?.trim() && !result.toolCalls?.length && !result.toolResults?.length) {
      throw new CliPluginError("NO_OUTPUT", "Gemini query returned no output");
    }
    return result;
  }

  async *stream(options: CliQueryOptions): AsyncIterable<CliQueryEvent> {
    const attachmentPrefix = (options.attachments ?? []).map((attachment) => `@${attachment.path}`).join(" ");
    const prompt = combinedInitialInput(
      options.systemPrompt,
      [attachmentPrefix, options.prompt].filter(Boolean).join("\n\n"),
    );
    const selectedTools = options.allowedTools?.length
      ? (options.tools ?? options.allowedTools).filter((tool) => options.allowedTools!.includes(tool))
      : options.tools ?? [];
    const parsedTools = selectedTools.map(geminiTool);
    const policyPath = path.join(this.host.storageDir, `assistant-policy-${randomUUID()}.toml`);
    this.host.fileSystem.mkdir(this.host.storageDir, { recursive: true });
    const rules = [
      '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 998\ninteractive = false',
      ...parsedTools.map((tool) => [
        "[[rule]]",
        ...(tool.server ? [`mcpName = ${tomlString(tool.server)}`] : []),
        `toolName = ${tomlString(tool.tool)}`,
        'decision = "allow"',
        "priority = 999",
        "interactive = false",
      ].join("\n")),
    ];
    try {
      this.host.fileSystem.writeText(policyPath, `${rules.join("\n\n")}\n`);
      const args = [
        "--prompt", prompt,
        "--output-format", "stream-json",
        "--approval-mode", "yolo",
        "--admin-policy", policyPath,
      ];
      if (options.model) args.push("--model", options.model);
      const servers = [...new Set(parsedTools.flatMap((tool) => tool.server ? [tool.server] : []))];
      if (servers.length) args.push("--allowed-mcp-server-names", servers.join(","));
      if (parsedTools.length) {
        args.push("--allowed-tools", parsedTools.map((tool) =>
          tool.server ? `mcp_${tool.server}_${tool.tool}` : tool.tool
        ).join(","));
      }
      let sawError = false;
      let sawFinish = false;
      const toolNames = new Map<string, string>();
      for await (const line of streamProcessJsonLines(
        this.host.process,
        { command: this.command(), args, cwd: options.cwd },
        {
          signal: options.signal ?? this.host.signal,
          timeoutMs: options.timeoutMs,
          maxOutputBytes: options.maxOutputBytes,
        },
      )) {
        if (line.type === "malformed") continue;
        if (line.type === "exit") {
          if (line.exitCode !== 0 && !sawError) {
            yield { type: "error", error: { code: classifyCliQueryFailure(line.stderr), message: "Gemini query failed" } };
          } else if (line.exitCode === 0 && !sawFinish) {
            yield { type: "finish", reason: "stop" };
          }
          continue;
        }
        const event = record(line.value);
        if (!event) continue;
        if (event.type === "init") {
          const sessionId = typeof event.session_id === "string" ? event.session_id
            : typeof event.sessionId === "string" ? event.sessionId : undefined;
          if (sessionId) yield { type: "session", sessionId };
        } else if (event.type === "message" && typeof event.content === "string") {
          if (event.thought === true || event.role === "reasoning") {
            yield { type: "reasoning", text: event.content };
          } else if (event.role === "assistant" || event.role === "model") {
            yield { type: "text", text: event.content };
          }
        } else if (event.type === "tool_use") {
          const id = typeof event.tool_id === "string" ? event.tool_id
            : typeof event.id === "string" ? event.id : undefined;
          if (!id) continue;
          const providerName = typeof event.tool_name === "string" ? event.tool_name
            : typeof event.name === "string" ? event.name : "unknown";
          const name = canonicalCliToolName(providerName, selectedTools);
          toolNames.set(id, name);
          yield { type: "tool-call", toolCall: { id, name, input: event.parameters ?? event.input } };
        } else if (event.type === "tool_result") {
          const id = typeof event.tool_id === "string" ? event.tool_id
            : typeof event.id === "string" ? event.id : undefined;
          if (!id) continue;
          const failed = event.status === "error" || event.error !== undefined;
          yield {
            type: "tool-result",
            toolResult: {
              id,
              name: toolNames.get(id) ?? (typeof event.tool_name === "string"
                ? canonicalCliToolName(event.tool_name, selectedTools)
                : undefined),
              output: event.output,
              ...(failed ? { error: { code: "TOOL_ERROR", message: "Gemini tool execution failed" } } : {}),
            },
          };
        } else if (event.type === "error") {
          sawError = true;
          yield { type: "error", error: { code: "PROVIDER_FAILURE", message: "Gemini query failed" } };
        } else if (event.type === "result") {
          const usage = geminiUsage(event.stats);
          if (usage) yield { type: "usage", usage };
          if (event.status === "error") {
            sawError = true;
            yield { type: "error", error: { code: "PROVIDER_FAILURE", message: "Gemini query failed" } };
          } else {
            sawFinish = true;
            yield { type: "finish", reason: typeof event.status === "string" ? event.status : "stop" };
          }
        }
      }
    } finally {
      await this.host.fileSystem.unlink(policyPath).catch(() => {});
    }
  }

  async models() {
    return [];
  }

  private command(): string {
    return this.host.resources.commandPath ?? "gemini";
  }

  private async run(
    args: string[],
    cwd?: string,
    timeoutMs = 10_000,
    required = true,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await this.host.process.execute({ command: this.command(), args, cwd }, {
      timeoutMs,
      signal: signal ?? this.host.signal,
    });
    if (required && result.exitCode !== 0) {
      throw new CliPluginError("INTEGRATION_FAILED", `Gemini CLI exited with code ${result.exitCode ?? "signal"}`);
    }
    return `${result.stdout}\n${result.stderr}`;
  }
}

export { combinedInitialInput };
