import {
  CliPluginError,
  classifyCliQueryFailure,
  collectCliQueryStream,
  defineCliPlugin,
  streamProcessJsonLines,
  type CliHostContext,
  type CliPluginManifestV1,
  type CliProcessSpec,
  type CliQueryEvent,
  type CliQueryOptions,
  type CliQueryResult,
  type CliSessionFailure,
  type CliSessionFailureInput,
  type CliSessionOptions,
} from "@tower/ai-sdk";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function usage(value: unknown) {
  const raw = record(value);
  if (!raw) return undefined;
  return {
    inputTokens: typeof raw.input_tokens === "number" ? raw.input_tokens : undefined,
    outputTokens: typeof raw.output_tokens === "number" ? raw.output_tokens : undefined,
    cachedInputTokens: typeof raw.cache_read_input_tokens === "number"
      ? raw.cache_read_input_tokens
      : typeof raw.cached_input_tokens === "number" ? raw.cached_input_tokens : undefined,
  };
}

export const qwenManifest = {
  manifestVersion: 1,
  apiVersion: "1.0",
  id: "community.qwen-code",
  kind: "cli-provider",
  publisher: { id: "tower-community", name: "Tower Community" },
  display: {
    name: "Qwen Code",
    description: "Community provider for the Qwen Code CLI",
  },
  entry: "./dist/index.js",
  command: { default: "qwen", versionArgs: ["--version"] },
  cliDependency: {
    name: "Qwen Code CLI",
    homepage: "https://github.com/QwenLM/qwen-code",
    installDocs: "https://qwenlm.github.io/qwen-code-docs/en/users/overview/",
    supportedVersions: ">=0.18.0 <1.0.0",
    managedByTower: false,
  },
  compatibility: { tower: ">=0.3.0 <0.4.0", node: ">=20" },
  capabilities: {
    sessions: { fresh: true, resume: true, continue: true },
    query: { generate: true, stream: true },
    models: false,
    integrations: { mcp: false, hooks: false, skills: false },
  },
  permissions: ["process:spawn", "network:provider"],
  configSchema: "./config.schema.json",
} satisfies CliPluginManifestV1;

export class QwenCodeAdapter {
  constructor(private readonly host: CliHostContext) {}

  buildSessionProcess(options: CliSessionOptions): CliProcessSpec {
    const args: string[] = [];
    if (options.mode.type === "resume") args.push("--resume", options.mode.sessionId);
    if (options.mode.type === "continue") args.push("--continue");
    if (options.systemPrompt) args.push("--append-system-prompt", options.systemPrompt);
    if (options.model) args.push("--model", options.model);
    if (options.extraArgs?.length) args.push(...options.extraArgs);
    return {
      command: this.command(),
      args,
      cwd: options.cwd,
      envPatch: options.envPatch,
      initialInput: options.prompt || undefined,
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
    return /session .*not found|no session|invalid session|could not resume/i.test(input.output)
      ? { code: "SESSION_NOT_FOUND", retryableWithFresh: true, diagnostic: "Qwen Code session was not found" }
      : { code: "UNKNOWN", retryableWithFresh: false };
  }

  async generate(options: CliQueryOptions): Promise<CliQueryResult> {
    const result = await collectCliQueryStream(this.stream(options));
    if (!result.text?.trim() && !result.toolCalls?.length && !result.toolResults?.length) {
      throw new CliPluginError("NO_OUTPUT", "Qwen Code query returned no output");
    }
    return result;
  }

  async *stream(options: CliQueryOptions): AsyncIterable<CliQueryEvent> {
    if (options.attachments?.length) {
      throw new CliPluginError("ATTACHMENT_UNAVAILABLE", "Qwen Code provider does not map Tower attachments");
    }
    if (options.tools?.length || options.allowedTools?.length) {
      throw new CliPluginError("TOOLING_UNAVAILABLE", "Qwen Code Tower tool integration is not enabled");
    }
    const args = ["--prompt", options.prompt, "--output-format", "stream-json"];
    if (options.systemPrompt) args.push("--append-system-prompt", options.systemPrompt);
    if (options.model) args.push("--model", options.model);
    if (options.maxTurns) args.push("--max-session-turns", String(options.maxTurns));

    let sawError = false;
    let sawFinish = false;
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
          yield {
            type: "error",
            error: { code: classifyCliQueryFailure(line.stderr), message: "Qwen Code query failed" },
          };
        } else if (line.exitCode === 0 && !sawFinish) {
          yield { type: "finish", reason: "stop" };
        }
        continue;
      }
      const event = record(line.value);
      if (!event) continue;
      const sessionId = typeof event.session_id === "string" ? event.session_id : undefined;
      if (event.type === "system" && sessionId) {
        yield { type: "session", sessionId };
        continue;
      }
      if (event.type === "assistant") {
        const message = record(event.message);
        const content = Array.isArray(message?.content) ? message.content : [];
        for (const rawBlock of content) {
          const block = record(rawBlock);
          if (!block) continue;
          if (block.type === "text" && typeof block.text === "string") {
            yield { type: "text", text: block.text };
          } else if ((block.type === "thinking" || block.type === "reasoning")
            && typeof block.text === "string") {
            yield { type: "reasoning", text: block.text };
          } else if (block.type === "tool_use"
            && typeof block.id === "string"
            && typeof block.name === "string") {
            yield {
              type: "tool-call",
              toolCall: { id: block.id, name: block.name, input: block.input },
            };
          }
        }
        continue;
      }
      if (event.type === "result") {
        const tokenUsage = usage(event.usage);
        if (tokenUsage) yield { type: "usage", usage: tokenUsage };
        if (event.is_error === true || event.subtype === "error") {
          sawError = true;
          yield { type: "error", error: { code: "PROVIDER_FAILURE", message: "Qwen Code query failed" } };
        } else {
          sawFinish = true;
          yield { type: "finish", reason: typeof event.subtype === "string" ? event.subtype : "stop" };
        }
      }
    }
  }

  async models() {
    return [];
  }

  private command(): string {
    return this.host.resources?.commandPath ?? "qwen";
  }
}

export const towerCliPlugin = defineCliPlugin({
  manifest: qwenManifest,
  createAdapter: (host) => new QwenCodeAdapter(host),
});
