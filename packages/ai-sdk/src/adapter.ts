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
  systemPrompt?: string;
  model?: string;
  extraArgs?: string[];
  envPatch?: Record<string, string | null>;
  settings?: Readonly<Record<string, unknown>>;
}

export interface CliProbeOptions {
  command: string;
  cwd: string;
  prompt: string;
}

export interface CliSessionFailure {
  code: "SESSION_NOT_FOUND" | "AUTH_REQUIRED" | "UNKNOWN";
  retryableWithFresh: boolean;
  diagnostic?: string;
}

export interface CliSessionFailureInput {
  mode: Exclude<CliSessionMode, { type: "fresh" }>;
  exitCode: number;
  output: string;
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

export interface CliMcpServerOptions {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envVars?: string[];
  scope?: "user" | "project" | "local";
  cwd?: string;
}

export interface CliHookOptions {
  apiUrl?: string;
  repairOnly?: boolean;
}

export interface CliSkillOptions {
  name: string;
  sourceDir?: string;
  scope?: "user" | "workspace";
}

export interface CliIntegration<TOptions = void> {
  inspect(options: TOptions): Promise<CliIntegrationState>;
  install(options: TOptions): Promise<CliIntegrationResult>;
  uninstall(options: TOptions): Promise<CliIntegrationResult>;
}

export interface CliAdapter {
  buildSessionProcess(options: CliSessionOptions): CliProcessSpec;
  /** Optional v1 extension used by hosts that offer an active connection test. */
  buildHelloProbe?(options: CliProbeOptions): CliProcessSpec;
  classifySessionFailure?(input: CliSessionFailureInput): CliSessionFailure;
  generate(options: CliQueryOptions): Promise<CliQueryResult>;
  stream?(options: CliQueryOptions): AsyncIterable<CliQueryEvent>;
  models(): Promise<CliModel[]>;
  mcp?: CliIntegration<CliMcpServerOptions>;
  hooks?: CliIntegration<CliHookOptions>;
  skills?: CliIntegration<CliSkillOptions>;
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

/** Standard package export used by Tower to locate a CLI provider module. */
export const CLI_PLUGIN_EXPORT_PATH = "./tower-cli-provider" as const;
/** Standard named ESM export exposed by the provider entry module. */
export const CLI_PLUGIN_EXPORT_NAME = "towerCliPlugin" as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the module export shape without invoking plugin code. */
export function isCliPlugin(value: unknown): value is CliPlugin {
  return isRecord(value)
    && isCliPluginManifestV1(value.manifest)
    && typeof value.createAdapter === "function";
}

function isCliIntegration(value: unknown): value is CliIntegration<unknown> {
  return isRecord(value)
    && typeof value.inspect === "function"
    && typeof value.install === "function"
    && typeof value.uninstall === "function";
}

/** Validate the adapter returned by a plugin before exposing it to the host. */
export function isCliAdapter(value: unknown): value is CliAdapter {
  return isRecord(value)
    && typeof value.buildSessionProcess === "function"
    && (value.buildHelloProbe === undefined || typeof value.buildHelloProbe === "function")
    && typeof value.generate === "function"
    && typeof value.models === "function"
    && (value.stream === undefined || typeof value.stream === "function")
    && (value.mcp === undefined || isCliIntegration(value.mcp))
    && (value.hooks === undefined || isCliIntegration(value.hooks))
    && (value.skills === undefined || isCliIntegration(value.skills));
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
