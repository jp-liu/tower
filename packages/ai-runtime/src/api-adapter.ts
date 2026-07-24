import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  Output,
  dynamicTool,
  generateText,
  jsonSchema,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { apiErrorFromStatus, normalizeApiError, safeErrorShape, ApiRuntimeError } from "./api-errors.js";
import type {
  ApiAdapter,
  ApiAttemptContext,
  ApiConnectionRuntimeConfig,
  ApiCredential,
  ApiGenerateRequest,
  ApiGenerateResult,
  ApiStreamEvent,
  ApiStructuredRequest,
  ApiToolCall,
  ApiToolResult,
  DiscoveredApiModel,
  ModelDiscoveryResult,
} from "./api-types.js";

const ANONYMOUS_PLACEHOLDER = "tower-anonymous-placeholder";
const AUTH_HEADER_NAMES = new Set(["authorization", "x-api-key", "x-goog-api-key"]);

function enabledEntries(entries: ApiConnectionRuntimeConfig["headers"]): Record<string, string> {
  return Object.fromEntries(entries.filter((entry) => entry.enabled).map((entry) => [entry.name, entry.value]));
}

function hasExplicitAuthentication(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((name) => AUTH_HEADER_NAMES.has(name.toLowerCase()));
}

function protocolAuthHeader(protocol: ApiConnectionRuntimeConfig["protocol"]): string {
  if (protocol === "anthropic") return "x-api-key";
  if (protocol === "google") return "x-goog-api-key";
  return "authorization";
}

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input.toString());
}

function providerBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function replaceRequestUrl(request: Request, url: URL, headers: Headers): Request {
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
  const requestInit: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body,
    signal: request.signal,
    cache: request.cache,
    credentials: request.credentials,
    integrity: request.integrity,
    keepalive: request.keepalive,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    ...(body ? { duplex: "half" as const } : {}),
  };
  return new Request(url, requestInit);
}

export function createControlledFetch(
  config: ApiConnectionRuntimeConfig,
  credential: ApiCredential,
  rawFetch: typeof fetch,
): typeof fetch {
  const customHeaders = enabledEntries(config.headers);
  const explicitAuth = hasExplicitAuthentication(customHeaders);
  const baseQuery = new URL(config.baseUrl).searchParams;
  const query = config.queryParams.filter((entry) => entry.enabled);
  return async (input, init) => {
    const request = new Request(input, init);
    const url = requestUrl(input);
    baseQuery.forEach((value, name) => url.searchParams.set(name, value));
    for (const entry of query) url.searchParams.set(entry.name, entry.value);

    const headers = new Headers(request.headers);
    if (!credential.value || explicitAuth) headers.delete(protocolAuthHeader(config.protocol));
    for (const [name, value] of Object.entries(customHeaders)) headers.set(name, value);

    return rawFetch(replaceRequestUrl(request, url, headers));
  };
}

function createModel(
  config: ApiConnectionRuntimeConfig,
  credential: ApiCredential,
  modelId: string,
  rawFetch: typeof fetch,
): LanguageModel {
  const headers = enabledEntries(config.headers);
  const apiKey = credential.value && !hasExplicitAuthentication(headers)
    ? credential.value
    : ANONYMOUS_PLACEHOLDER;
  const controlledFetch = createControlledFetch(config, credential, rawFetch);
  switch (config.protocol) {
    case "openai":
      return createOpenAI({ baseURL: providerBaseUrl(config.baseUrl), apiKey, fetch: controlledFetch }).responses(modelId);
    case "openai-compatible":
      return createOpenAICompatible<string, string, string, string>({
        name: config.name,
        baseURL: providerBaseUrl(config.baseUrl),
        apiKey,
        fetch: controlledFetch,
      }).chatModel(modelId);
    case "anthropic":
      return createAnthropic({ baseURL: providerBaseUrl(config.baseUrl), apiKey, fetch: controlledFetch }).messages(modelId);
    case "google":
      return createGoogleGenerativeAI({ baseURL: providerBaseUrl(config.baseUrl), apiKey, fetch: controlledFetch }).languageModel(modelId);
  }
}

function buildTools(request: ApiGenerateRequest, context: ApiAttemptContext): ToolSet | undefined {
  if (!request.tools) return undefined;
  return Object.fromEntries(Object.entries(request.tools).map(([name, definition]) => [
    name,
    dynamicTool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
      ...(definition.execute
        ? {
            execute: async (input: unknown) => {
              context.onActivity();
              try {
                return await definition.execute?.(input);
              } catch {
                throw new ApiRuntimeError({
                  code: "tool_error",
                  message: "A tool execution failed",
                  cause: "ToolExecutionError",
                  retryableWithNextKey: false,
                });
              }
            },
          }
        : {}),
    }),
  ]));
}

function promptOptions(request: ApiGenerateRequest): { prompt: string } | { messages: ModelMessage[] } {
  if (request.messages) return { messages: request.messages as ModelMessage[] };
  return { prompt: request.prompt ?? "" };
}

function usageShape(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined) {
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

function toolCallShape(call: Record<string, unknown>): ApiToolCall {
  return {
    toolCallId: String(call.toolCallId),
    toolName: String(call.toolName),
    input: call.input,
  };
}

function toolResultShape(result: Record<string, unknown>): ApiToolResult {
  return {
    toolCallId: String(result.toolCallId),
    toolName: String(result.toolName),
    output: result.output,
  };
}

function generationOptions(request: ApiGenerateRequest, context: ApiAttemptContext) {
  return {
    ...promptOptions(request),
    instructions: request.system,
    maxOutputTokens: request.maxOutputTokens,
    temperature: request.temperature,
    abortSignal: request.abortSignal,
    timeout: request.timeoutMs,
    maxRetries: 0,
    tools: buildTools(request, context),
    onToolExecutionStart: () => context.onActivity(),
  };
}

function modelListUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  return url;
}

function listHeaders(config: ApiConnectionRuntimeConfig, credential: ApiCredential): Headers {
  const headers = new Headers();
  const custom = enabledEntries(config.headers);
  if (credential.value && !hasExplicitAuthentication(custom)) {
    const name = protocolAuthHeader(config.protocol);
    headers.set(name, name === "authorization" ? `Bearer ${credential.value}` : credential.value);
  }
  for (const [name, value] of Object.entries(custom)) headers.set(name, value);
  return headers;
}

function parseModels(protocol: ApiConnectionRuntimeConfig["protocol"], body: unknown): DiscoveredApiModel[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const rows = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  return rows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const model = item as Record<string, unknown>;
    const rawId = typeof model.id === "string" ? model.id : typeof model.name === "string" ? model.name : null;
    if (!rawId) return [];
    const id = protocol === "google" && rawId.startsWith("models/") ? rawId.slice(7) : rawId;
    const capabilities = Array.isArray(model.supportedGenerationMethods)
      ? { supportedGenerationMethods: model.supportedGenerationMethods }
      : undefined;
    return [{ id, capabilities, metadata: model }];
  });
}

class VercelApiAdapter implements ApiAdapter {
  readonly protocol: ApiConnectionRuntimeConfig["protocol"];

  constructor(
    private readonly config: ApiConnectionRuntimeConfig,
    private readonly rawFetch: typeof fetch,
  ) {
    this.protocol = config.protocol;
  }

  async generate(request: ApiGenerateRequest, context: ApiAttemptContext): Promise<ApiGenerateResult> {
    try {
      const result = await generateText({
        model: createModel(this.config, context.credential, request.modelId, this.rawFetch),
        ...generationOptions(request, context),
      });
      if (result.text || result.reasoningText || result.toolCalls.length || result.toolResults.length) {
        context.onActivity();
      }
      return {
        text: result.text,
        reasoning: result.reasoningText,
        toolCalls: result.toolCalls.map((item) => toolCallShape(item as unknown as Record<string, unknown>)),
        toolResults: result.toolResults.map((item) => toolResultShape(item as unknown as Record<string, unknown>)),
        finishReason: result.finishReason,
        usage: usageShape(result.usage),
      };
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async *stream(request: ApiGenerateRequest, context: ApiAttemptContext): AsyncIterable<ApiStreamEvent> {
    try {
      const result = streamText({
        model: createModel(this.config, context.credential, request.modelId, this.rawFetch),
        ...generationOptions(request, context),
      });
      for await (const part of result.stream) {
        if (part.type === "error") throw part.error;
        if (part.type === "abort") throw new DOMException("Aborted", "AbortError");
        if (part.type === "text-delta") {
          context.onActivity();
          yield { type: "text", delta: part.text };
        } else if (part.type === "reasoning-delta") {
          context.onActivity();
          yield { type: "reasoning", delta: part.text };
        } else if (part.type === "tool-call") {
          context.onActivity();
          yield { type: "tool-call", call: toolCallShape(part as unknown as Record<string, unknown>) };
        } else if (part.type === "tool-result") {
          context.onActivity();
          yield { type: "tool-result", result: toolResultShape(part as unknown as Record<string, unknown>) };
        } else if (part.type === "finish") {
          yield { type: "finish", finishReason: part.finishReason, usage: usageShape(part.totalUsage) };
        }
      }
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async generateStructured(request: ApiStructuredRequest, context: ApiAttemptContext): Promise<unknown> {
    try {
      const result = await generateText({
        model: createModel(this.config, context.credential, request.modelId, this.rawFetch),
        ...generationOptions(request, context),
        output: Output.object({
          schema: jsonSchema(request.schema),
          name: request.schemaName,
          description: request.schemaDescription,
        }),
      });
      context.onActivity();
      return result.output;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async listModels(credential: ApiCredential): Promise<ModelDiscoveryResult> {
    try {
      const url = modelListUrl(this.config.baseUrl);
      for (const entry of this.config.queryParams.filter((item) => item.enabled)) {
        url.searchParams.set(entry.name, entry.value);
      }
      const response = await this.rawFetch(url, { headers: listHeaders(this.config, credential) });
      if (!response.ok) throw apiErrorFromStatus(response.status);
      return { ok: true, models: parseModels(this.config.protocol, await response.json()) };
    } catch (error) {
      return { ok: false, models: [], error: safeErrorShape(error) };
    }
  }

  testConnection(modelId: string, credential: ApiCredential, signal?: AbortSignal): Promise<ApiGenerateResult> {
    return this.generate(
      { modelId, prompt: "Reply with OK.", maxOutputTokens: 8, temperature: 0, abortSignal: signal },
      { credential, onActivity: () => {} },
    );
  }
}

export function createApiAdapter(
  config: ApiConnectionRuntimeConfig,
  rawFetch: typeof fetch = globalThis.fetch,
): ApiAdapter {
  return new VercelApiAdapter(config, rawFetch);
}
