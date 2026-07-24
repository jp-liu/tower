import { APICallError } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import {
  ApiConnectionRuntime,
  ApiRuntimeError,
  MemoryApiRuntimeCursor,
  createApiAdapter,
  normalizeBaseUrl,
  safeErrorShape,
  serializeConfigEntries,
  type ApiAdapter,
  type ApiAttemptContext,
  type ApiConnectionRuntimeConfig,
  type ApiGenerateRequest,
  type ApiGenerateResult,
  type ApiStreamEvent,
} from "../src/index.js";

const success: ApiGenerateResult = {
  text: "OK",
  toolCalls: [],
  toolResults: [],
  finishReason: "stop",
};

function config(protocol: ApiConnectionRuntimeConfig["protocol"]): ApiConnectionRuntimeConfig {
  return {
    connectionId: "connection-1",
    protocol,
    name: "Test Provider",
    baseUrl: "http://127.0.0.1:11434/custom/v2",
    headers: [],
    queryParams: [],
  };
}

function responseFor(protocol: ApiConnectionRuntimeConfig["protocol"]): unknown {
  if (protocol === "openai") {
    return {
      id: "resp_1",
      model: "test-model",
      output: [{
        type: "message",
        role: "assistant",
        id: "msg_1",
        content: [{ type: "output_text", text: "OK", annotations: [] }],
      }],
      incomplete_details: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }
  if (protocol === "openai-compatible") {
    return {
      id: "chatcmpl_1",
      model: "test-model",
      choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  }
  if (protocol === "anthropic") {
    return {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [{ type: "text", text: "OK" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }
  return {
    candidates: [{ content: { role: "model", parts: [{ text: "OK" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  };
}

describe("API configuration", () => {
  it("preserves the complete user path and only trims whitespace/trailing slashes", () => {
    expect(normalizeBaseUrl("  http://localhost:11434/custom/v2///  ")).toBe(
      "http://localhost:11434/custom/v2",
    );
    expect(() => normalizeBaseUrl("ftp://localhost/models")).toThrow("http or https");
    expect(() => normalizeBaseUrl("https://user:secret@example.com/v1")).toThrow("credentials");
    expect(() => normalizeBaseUrl("https://example.com/v1#secret")).toThrow("fragment");
  });

  it("rejects transport headers and applies sensitive-name defaults", () => {
    expect(() => serializeConfigEntries([{
      id: "h1", name: "Host", value: "evil", enabled: true, sensitive: false,
    }], "header")).toThrow("controlled by the transport");
    const encoded = serializeConfigEntries([{
      id: "h2", name: "X-Custom-Token", value: "canary", enabled: true, sensitive: false,
    }], "header");
    expect(JSON.parse(encoded)[0].sensitive).toBe(true);
  });
});

describe("Vercel provider adapters", () => {
  for (const protocol of ["openai", "openai-compatible", "anthropic", "google"] as const) {
    it(`constructs ${protocol} with the exact Base URL and controlled request settings`, async () => {
      const requests: Array<{ url: URL; headers: Headers; body: string }> = [];
      const rawFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: new URL(input instanceof Request ? input.url : input.toString()),
          headers: new Headers(init?.headers),
          body: String(init?.body ?? ""),
        });
        return new Response(JSON.stringify(responseFor(protocol)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;
      const adapterConfig = config(protocol);
      adapterConfig.queryParams = [{
        id: "q1", name: "tenant", value: "tenant-value", enabled: true, sensitive: false,
      }];
      adapterConfig.headers = [{
        id: "h1", name: "Authorization", value: "Explicit custom auth", enabled: true, sensitive: true,
      }];
      const result = await createApiAdapter(adapterConfig, rawFetch).testConnection(
        "test-model",
        { id: "anonymous", value: "" },
      );

      expect(result.text).toBe("OK");
      expect(requests).toHaveLength(1);
      expect(requests[0]!.url.pathname.startsWith("/custom/v2/")).toBe(true);
      expect(requests[0]!.url.pathname).not.toContain("/v1/");
      expect(requests[0]!.url.searchParams.get("tenant")).toBe("tenant-value");
      expect(requests[0]!.headers.get("authorization")).toBe("Explicit custom auth");
      if (protocol === "openai") expect(requests[0]!.url.pathname.endsWith("/responses")).toBe(true);
      if (protocol === "openai-compatible") {
        expect(requests[0]!.url.pathname.endsWith("/chat/completions")).toBe(true);
      }
    });
  }

  it("treats zero keys as anonymous and discovers models separately from generation", async () => {
    const rawFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(url.pathname).toBe("/custom/v2/models");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return new Response(JSON.stringify({ data: [{ id: "local-model", owned_by: "local" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const result = await createApiAdapter(config("openai-compatible"), rawFetch).listModels({
      id: "anonymous",
      value: "",
    });
    expect(result).toEqual({
      ok: true,
      models: [{ id: "local-model", capabilities: undefined, metadata: { id: "local-model", owned_by: "local" } }],
    });
  });
});

class FakeAdapter implements ApiAdapter {
  readonly protocol = "openai-compatible" as const;
  readonly calls: string[] = [];

  constructor(
    private readonly generateAttempt: (context: ApiAttemptContext) => Promise<ApiGenerateResult>,
    private readonly streamAttempt: (context: ApiAttemptContext) => AsyncIterable<ApiStreamEvent> = async function* () {},
  ) {}

  generate(_request: ApiGenerateRequest, context: ApiAttemptContext) {
    this.calls.push(context.credential.id);
    return this.generateAttempt(context);
  }
  stream(_request: ApiGenerateRequest, context: ApiAttemptContext) {
    this.calls.push(context.credential.id);
    return this.streamAttempt(context);
  }
  generateStructured(_request: never, context: ApiAttemptContext) {
    return this.generateAttempt(context);
  }
  async listModels() { return { ok: true as const, models: [] }; }
  testConnection(_modelId: string, credential: { id: string; value: string }) {
    return this.generate({ modelId: _modelId }, { credential, onActivity: () => {} });
  }
}

function retryable(status: 401 | 403 | 429): ApiRuntimeError {
  return new ApiRuntimeError({
    code: status === 401 ? "authentication" : status === 403 ? "permission" : "rate_limit",
    message: "safe",
    status,
    cause: "HTTPError",
    retryableWithNextKey: true,
  });
}

describe("multi-key runtime", () => {
  const keys = [
    { id: "key-a", value: "a" },
    { id: "key-b", value: "b" },
  ];

  it.each([401, 403, 429] as const)("rotates on pre-output HTTP %s", async (status) => {
    const adapter = new FakeAdapter(async (context) => {
      if (context.credential.id === "key-a") throw retryable(status);
      return success;
    });
    const result = await new ApiConnectionRuntime(adapter, keys, new MemoryApiRuntimeCursor()).generate({
      modelId: "model",
      prompt: "private prompt",
    });
    expect(result.text).toBe("OK");
    expect(adapter.calls).toEqual(["key-a", "key-b"]);
  });

  it("round-robins the starting key for concurrent reservations", async () => {
    const adapter = new FakeAdapter(async () => success);
    const runtime = new ApiConnectionRuntime(adapter, keys, new MemoryApiRuntimeCursor());
    await Promise.all([
      runtime.generate({ modelId: "model", prompt: "one" }),
      runtime.generate({ modelId: "model", prompt: "two" }),
    ]);
    expect(adapter.calls).toEqual(["key-a", "key-b"]);
  });

  it("does not rotate after the first streamed output", async () => {
    const adapter = new FakeAdapter(async () => success, async function* (context) {
      if (context.credential.id === "key-a") {
        context.onActivity();
        yield { type: "text", delta: "partial" };
        throw retryable(429);
      }
      yield { type: "text", delta: "duplicate" };
    });
    const runtime = new ApiConnectionRuntime(adapter, keys, new MemoryApiRuntimeCursor());
    const events: ApiStreamEvent[] = [];
    await expect(async () => {
      for await (const event of runtime.stream({ modelId: "model", prompt: "secret" })) events.push(event);
    }).rejects.toMatchObject({ code: "rate_limit" });
    expect(events).toEqual([{ type: "text", delta: "partial" }]);
    expect(adapter.calls).toEqual(["key-a"]);
  });

  it("rotates a stream only when a retryable error happens before output", async () => {
    const adapter = new FakeAdapter(async () => success, async function* (context) {
      if (context.credential.id === "key-a") throw retryable(401);
      context.onActivity();
      yield { type: "text", delta: "second-key" };
    });
    const events: ApiStreamEvent[] = [];
    for await (const event of new ApiConnectionRuntime(
      adapter,
      keys,
      new MemoryApiRuntimeCursor(),
    ).stream({ modelId: "model" })) {
      events.push(event);
    }
    expect(events).toEqual([{ type: "text", delta: "second-key" }]);
    expect(adapter.calls).toEqual(["key-a", "key-b"]);
  });

  it("does not rotate after a tool side effect starts", async () => {
    const adapter = new FakeAdapter(async (context) => {
      context.onActivity();
      throw retryable(429);
    });
    await expect(new ApiConnectionRuntime(adapter, keys, new MemoryApiRuntimeCursor()).generate({
      modelId: "model",
      tools: { write: { inputSchema: { type: "object" }, execute: async () => "done" } },
    })).rejects.toMatchObject({ code: "rate_limit" });
    expect(adapter.calls).toEqual(["key-a"]);
  });

  it("does not rotate cancellation, invalid configuration, safety, or tool errors", async () => {
    for (const code of ["cancelled", "invalid_request", "content_safety", "tool_error"] as const) {
      const adapter = new FakeAdapter(async () => {
        throw new ApiRuntimeError({ code, message: "safe", cause: "SafeCause", retryableWithNextKey: false });
      });
      await expect(new ApiConnectionRuntime(adapter, keys, new MemoryApiRuntimeCursor()).generate({
        modelId: "model",
        prompt: "private",
      })).rejects.toMatchObject({ code });
      expect(adapter.calls).toEqual(["key-a"]);
    }
  });

  it("uses one anonymous candidate when a connection has zero keys", async () => {
    const adapter = new FakeAdapter(async () => success);
    await new ApiConnectionRuntime(adapter, [], new MemoryApiRuntimeCursor()).generate({ modelId: "local" });
    expect(adapter.calls).toEqual(["anonymous"]);
  });
});

describe("safe errors", () => {
  it("never returns Key, Header, Query, or Prompt canaries", () => {
    const secrets = [
      "CANARY_API_KEY_92A",
      "CANARY_HEADER_17B",
      "CANARY_QUERY_31C",
      "CANARY_PROMPT_44D",
    ];
    const error = new APICallError({
      message: secrets.join(" "),
      url: `https://example.test/v1?token=${secrets[2]}`,
      requestBodyValues: { prompt: secrets[3] },
      responseBody: `${secrets[0]} ${secrets[1]}`,
      statusCode: 401,
    });
    const serialized = JSON.stringify(safeErrorShape(error));
    expect(serialized).toContain("authentication");
    for (const secret of secrets) expect(serialized).not.toContain(secret);
  });
});
