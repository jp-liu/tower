import type { CliHostContext, CliProcessSpec } from "./process.js";
import type { CliPluginManifestV1 } from "./manifest.js";
import {
  CLI_PLUGIN_MANIFEST_VERSION,
  isCliPluginApiVersionCompatible,
  isCliPluginManifestV1,
} from "./manifest.js";
import { CliPluginError } from "./errors.js";

export type CliSessionMode =
  | { type: "fresh" }
  | { type: "resume"; sessionId: string }
  | { type: "continue" };

export interface CliSessionOptions {
  prompt: string;
  cwd: string;
  mode: CliSessionMode;
  model?: string;
  extraArgs?: string[];
  settings?: Readonly<Record<string, unknown>>;
}

export interface CliQueryOptions {
  prompt: string;
  cwd?: string;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  tools?: string[];
  allowedTools?: string[];
  settings?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}

export interface CliTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

export interface CliToolCall {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
}

export type CliQueryEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCall: CliToolCall }
  | { type: "usage"; usage: CliTokenUsage }
  | { type: "session"; sessionId: string }
  | { type: "finish"; reason?: string }
  | { type: "error"; error: { code: string; message: string; retryable?: boolean } };

export interface CliQueryResult {
  text: string | null;
  reasoning?: string;
  toolCalls?: CliToolCall[];
  usage?: CliTokenUsage;
  sessionId?: string;
  finishReason?: string;
}

export interface CliModel {
  id: string;
  displayName?: string;
  description?: string;
}

export interface CliIntegrationState {
  installed: boolean;
  detail?: string;
}

export interface CliIntegrationResult extends CliIntegrationState {
  changed: boolean;
}

export interface CliIntegration<TOptions = void> {
  inspect(options: TOptions): Promise<CliIntegrationState>;
  install(options: TOptions): Promise<CliIntegrationResult>;
  uninstall(options: TOptions): Promise<CliIntegrationResult>;
}

export interface CliAdapter {
  buildSessionProcess(options: CliSessionOptions): CliProcessSpec;
  generate(options: CliQueryOptions): Promise<CliQueryResult>;
  stream?(options: CliQueryOptions): AsyncIterable<CliQueryEvent>;
  models(): Promise<CliModel[]>;
  mcp?: CliIntegration<unknown>;
  hooks?: CliIntegration<unknown>;
  skills?: CliIntegration<unknown>;
}

export abstract class BaseCliAdapter implements CliAdapter {
  constructor(protected readonly host: CliHostContext) {}

  abstract buildSessionProcess(options: CliSessionOptions): CliProcessSpec;
  abstract generate(options: CliQueryOptions): Promise<CliQueryResult>;
  abstract models(): Promise<CliModel[]>;

  async *stream(options: CliQueryOptions): AsyncIterable<CliQueryEvent> {
    const result = await this.generate(options);
    if (result.reasoning) yield { type: "reasoning", text: result.reasoning };
    if (result.text) yield { type: "text", text: result.text };
    for (const toolCall of result.toolCalls ?? []) yield { type: "tool-call", toolCall };
    if (result.usage) yield { type: "usage", usage: result.usage };
    if (result.sessionId) yield { type: "session", sessionId: result.sessionId };
    yield { type: "finish", reason: result.finishReason };
  }
}

export interface CliPlugin<TSettings extends Record<string, unknown> = Record<string, unknown>> {
  manifest: CliPluginManifestV1;
  createAdapter(host: CliHostContext, settings: Readonly<TSettings>): CliAdapter;
}

export function defineCliPlugin<TSettings extends Record<string, unknown>>(
  plugin: CliPlugin<TSettings>,
): CliPlugin<TSettings> {
  if (!isCliPluginManifestV1(plugin.manifest)) {
    throw new CliPluginError("INVALID_MANIFEST", "Invalid CLI plugin manifest");
  }
  if (plugin.manifest.manifestVersion !== CLI_PLUGIN_MANIFEST_VERSION) {
    throw new CliPluginError("INVALID_MANIFEST", "Unsupported CLI plugin manifest version");
  }
  if (plugin.manifest.kind !== "cli-provider") {
    throw new CliPluginError("INVALID_MANIFEST", "Only CLI provider plugins are supported");
  }
  if (!isCliPluginApiVersionCompatible(plugin.manifest.apiVersion)) {
    throw new CliPluginError(
      "INCOMPATIBLE_API_VERSION",
      `Unsupported CLI plugin API version: ${plugin.manifest.apiVersion}`,
    );
  }
  if (!plugin.manifest.command.default.trim()) {
    throw new CliPluginError("INVALID_MANIFEST", "CLI plugin default command is required");
  }
  return Object.freeze(plugin);
}
