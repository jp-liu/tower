import {
  CliPluginError,
  type CliAdapter,
  type CliHostContext,
  type CliHostResources,
  type CliIntegrationResult,
  type CliMcpServerOptions,
  type CliProcessSpec,
  type CliQueryOptions,
  type CliQueryResult,
  type CliSessionFailure,
  type CliSessionFailureInput,
  type CliSessionOptions,
  type CliSkillOptions,
} from "@tower/ai-sdk";

type ProviderHost = CliHostContext & { resources: CliHostResources };

function requireProviderHost(host: CliHostContext): ProviderHost {
  if (!host.resources) {
    throw new CliPluginError("UNSUPPORTED_CAPABILITY", "Gemini provider requires Host resources");
  }
  return host as ProviderHost;
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
      const result = await this.run(["mcp", "list"], options.cwd, 5_000, false);
      return { installed: result.includes(options.name) };
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
    const prompt = combinedInitialInput(options.systemPrompt, options.prompt);
    const args = ["--prompt", prompt, "--output-format", "text"];
    if (options.model) args.push("--model", options.model);
    const result = await this.host.process.execute({ command: this.command(), args, cwd: options.cwd }, {
      signal: options.signal ?? this.host.signal,
    });
    if (result.exitCode !== 0) throw new CliPluginError("QUERY_FAILED", "Gemini query failed");
    return { text: result.stdout.trim() || null };
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
  ): Promise<string> {
    const result = await this.host.process.execute({ command: this.command(), args, cwd }, {
      timeoutMs,
      signal: this.host.signal,
    });
    if (required && result.exitCode !== 0) {
      throw new CliPluginError("INTEGRATION_FAILED", `Gemini CLI exited with code ${result.exitCode ?? "signal"}`);
    }
    return `${result.stdout}\n${result.stderr}`;
  }
}

export { combinedInitialInput };
