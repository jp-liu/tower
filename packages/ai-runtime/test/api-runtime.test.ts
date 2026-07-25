import { APICallError } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import {
  ApiConnectionRuntime,
  ApiRuntimeError,
  MemoryApiRuntimeCursor,
  createApiAdapter,
  createControlledFetch,
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

async function inspectRequest(input: string | URL | Request, init?: RequestInit) {
  const request = new Request(input, init);
  return {
    url: new URL(request.url),
    headers: new Headers(request.headers),
    body: await request.text(),
    method: request.method,
  };
}

describe("API configuration", () => {
  it("preserves the complete user path and only trims whitespace/trailing slashes", () => {
    expect(normalizeBaseUrl("  http://localhost:11434/custom/v2///  ")).toBe(
      "http://localhost:11434/custom/v2",
    );
    expect(normalizeBaseUrl("https://example.test/custom/v1///?tenant=one")).toBe(
      "https://example.test/custom/v1?tenant=one",
    );
    expect(normalizeBaseUrl("https://example.test///?tenant=one")).toBe(
      "https://example.test?tenant=one",
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

describe("controlled fetch", () => {
  it("preserves Request and init semantics while applying custom query and headers", async () => {
    const controller = new AbortController();
    let captured: Request | undefined;
    const rawFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      captured = new Request(input, init);
      return new Response("OK");
    }) as unknown as typeof fetch;
    const adapterConfig = config("openai-compatible");
    adapterConfig.baseUrl = "http://127.0.0.1:11434/custom/v2?base=one";
    adapterConfig.headers = [{
      id: "h1", name: "X-Custom", value: "custom-value", enabled: true, sensitive: false,
    }];
    adapterConfig.queryParams = [{
      id: "q1", name: "tenant", value: "tenant-value", enabled: true, sensitive: false,
    }];
    const source = new Request("http://127.0.0.1:11434/custom/v2/generate?request=one", {
      method: "POST",
      body: "request-body",
      headers: { "X-Original": "original-value" },
      signal: controller.signal,
      credentials: "include",
    });

    await createControlledFetch(
      adapterConfig,
      { id: "anonymous", value: "" },
      rawFetch,
    )(source);

    expect(captured).toBeDefined();
    expect(captured!.method).toBe("POST");
    expect(captured!.credentials).toBe("include");
    expect(captured!.headers.get("x-original")).toBe("original-value");
    expect(captured!.headers.get("x-custom")).toBe("custom-value");
    expect(new URL(captured!.url).searchParams.get("request")).toBe("one");
    expect(new URL(captured!.url).searchParams.get("base")).toBe("one");
    expect(new URL(captured!.url).searchParams.get("tenant")).toBe("tenant-value");
    expect(await captured!.text()).toBe("request-body");
    expect(captured!.signal.aborted).toBe(false);
    controller.abort();
    expect(captured!.signal.aborted).toBe(true);
  });
});

describe("Vercel provider adapters", () => {
  for (const protocol of ["openai", "openai-compatible", "anthropic", "google"] as const) {
    it(`constructs ${protocol} with the exact Base URL and controlled request settings`, async () => {
      const requests: Array<{ url: URL; headers: Headers; body: string }> = [];
      const rawFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push(await inspectRequest(input, init));
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

  const authCases = [
    { protocol: "openai", header: "authorization", format: (key: string) => `Bearer ${key}` },
    { protocol: "openai-compatible", header: "authorization", format: (key: string) => `Bearer ${key}` },
    { protocol: "anthropic", header: "x-api-key", format: (key: string) => key },
    { protocol: "google", header: "x-goog-api-key", format: (key: string) => key },
  ] as const;

  it.each(authCases)("sends $protocol default authentication and redacts failures", async ({
    protocol,
    header,
    format,
  }) => {
    const key = `CANARY_${protocol.toUpperCase().replace("-", "_")}_KEY`;
    const requests: Awaited<ReturnType<typeof inspectRequest>>[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(await inspectRequest(input, init));
      return new Response(JSON.stringify({ error: { message: `upstream rejected ${key}` } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      let error: unknown;
      try {
        await createApiAdapter(config(protocol), rawFetch).testConnection(
          "test-model",
          { id: "key-1", value: key },
        );
      } catch (caught) {
        error = caught;
      }

      expect(requests).toHaveLength(1);
      expect(requests[0]!.headers.get(header)).toBe(format(key));
      expect(error).toMatchObject({ code: "authentication", status: 401 });
      const report = JSON.stringify(safeErrorShape(error));
      expect(report).not.toContain(key);
      expect(String(error)).not.toContain(key);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it.each(authCases)("does not send $protocol credentials for an anonymous connection", async ({
    protocol,
  }) => {
    const requests: Awaited<ReturnType<typeof inspectRequest>>[] = [];
    const rawFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(await inspectRequest(input, init));
      return new Response(JSON.stringify(responseFor(protocol)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await createApiAdapter(config(protocol), rawFetch).testConnection(
      "test-model",
      { id: "anonymous", value: "" },
    );

    const serializedRequest = JSON.stringify({
      url: requests[0]!.url.toString(),
      headers: Object.fromEntries(requests[0]!.headers),
      body: requests[0]!.body,
    });
    expect(requests[0]!.headers.has("authorization")).toBe(false);
    expect(requests[0]!.headers.has("x-api-key")).toBe(false);
    expect(requests[0]!.headers.has("x-goog-api-key")).toBe(false);
    expect(serializedRequest).not.toContain("tower-anonymous-placeholder");
  });

  it.each(authCases)("lets explicit $header override $protocol default authentication", async ({
    protocol,
    header,
  }) => {
    const generatedKey = `CANARY_${protocol.toUpperCase().replace("-", "_")}_GENERATED_KEY`;
    const explicitValue = `Explicit ${protocol} credential`;
    const requests: Awaited<ReturnType<typeof inspectRequest>>[] = [];
    const rawFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(await inspectRequest(input, init));
      return new Response(JSON.stringify(responseFor(protocol)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const adapterConfig = config(protocol);
    adapterConfig.headers = [{
      id: "explicit-auth",
      name: header,
      value: explicitValue,
      enabled: true,
      sensitive: true,
    }];

    await createApiAdapter(adapterConfig, rawFetch).testConnection(
      "test-model",
      { id: "key-1", value: generatedKey },
    );

    expect(requests[0]!.headers.get(header)).toBe(explicitValue);
    const serializedRequest = JSON.stringify({
      url: requests[0]!.url.toString(),
      headers: Object.fromEntries(requests[0]!.headers),
      body: requests[0]!.body,
    });
    expect(serializedRequest).not.toContain(generatedKey);
    expect(serializedRequest).not.toContain("tower-anonymous-placeholder");
  });

  it("treats zero keys as anonymous and discovers models separately from generation", async () => {
    const rawFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = await inspectRequest(input, init);
      const { url } = request;
      expect(url.pathname).toBe("/custom/v2/models");
      expect(request.headers.has("authorization")).toBe(false);
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

  it("returns tool results to the model across multiple steps before final text", async () => {
    const requests: Awaited<ReturnType<typeof inspectRequest>>[] = [];
    const rawFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(await inspectRequest(input, init));
      const step = requests.length;
      const response = step <= 2
        ? {
            id: `chatcmpl_${step}`,
            model: "test-model",
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: `call_${step}`,
                  type: "function",
                  function: { name: "lookup", arguments: JSON.stringify({ step }) },
                }],
              },
              finish_reason: "tool_calls",
            }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }
        : responseFor("openai-compatible");
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const execute = vi.fn(async (input: unknown) => ({ acknowledged: input }));

    const result = await createApiAdapter(config("openai-compatible"), rawFetch).generate({
      modelId: "test-model",
      prompt: "private prompt",
      maxTurns: 3,
      tools: {
        lookup: {
          description: "Look up a step",
          inputSchema: {
            type: "object",
            properties: { step: { type: "number" } },
            required: ["step"],
            additionalProperties: false,
          },
          execute,
        },
      },
    }, { credential: { id: "anonymous", value: "" }, onActivity: vi.fn() });

    expect(requests).toHaveLength(3);
    expect(execute.mock.calls).toEqual([[{ step: 1 }], [{ step: 2 }]]);
    expect(result.text).toBe("OK");
    expect(result.toolCalls.map((call) => call.toolCallId)).toEqual(["call_1", "call_2"]);
    expect(result.toolResults.map((item) => item.toolCallId)).toEqual(["call_1", "call_2"]);
    expect(requests.slice(1).every(({ body }) => body.includes('"role":"tool"'))).toBe(true);
    expect(JSON.parse(requests[0]!.body).max_retries).toBeUndefined();
  });

  it("serializes provider-neutral tool history for a continuation request", async () => {
    const requests: Awaited<ReturnType<typeof inspectRequest>>[] = [];
    const rawFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(await inspectRequest(input, init));
      return new Response(JSON.stringify(responseFor("openai-compatible")), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await createApiAdapter(config("openai-compatible"), rawFetch).generate({
      modelId: "test-model",
      messages: [
        { role: "user", content: "continue" },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "historic-call", toolName: "lookup", input: { step: 0 } }],
        },
        {
          role: "tool",
          content: [{
            type: "tool-result",
            toolCallId: "historic-call",
            toolName: "lookup",
            output: { type: "json", value: { done: true } },
          }],
        },
      ],
      tools: { lookup: { inputSchema: { type: "object" } } },
    }, { credential: { id: "anonymous", value: "" }, onActivity: vi.fn() });

    expect(result.text).toBe("OK");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).toContain("historic-call");
    expect(requests[0]!.body).toContain('"role":"tool"');
  });

  it("stops the API tool loop at maxTurns without transport retries", async () => {
    const requests: Awaited<ReturnType<typeof inspectRequest>>[] = [];
    const rawFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(await inspectRequest(input, init));
      return new Response(JSON.stringify({
        id: "chatcmpl_tool",
        model: "test-model",
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_once",
              type: "function",
              function: { name: "lookup", arguments: '{"step":1}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const execute = vi.fn(async () => ({ ok: true }));

    const result = await createApiAdapter(config("openai-compatible"), rawFetch).generate({
      modelId: "test-model",
      prompt: "private prompt",
      maxTurns: 1,
      tools: {
        lookup: {
          inputSchema: { type: "object", properties: { step: { type: "number" } } },
          execute,
        },
      },
    }, { credential: { id: "anonymous", value: "" }, onActivity: vi.fn() });

    expect(requests).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("");
    expect(result.finishReason).toBe("tool-calls");
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

  it("forwards non-stream activity to the outer fallback boundary", async () => {
    const outerActivity = vi.fn();
    const adapter = new FakeAdapter(async (context) => {
      context.onActivity();
      throw retryable(429);
    });
    await expect(new ApiConnectionRuntime(adapter, keys, new MemoryApiRuntimeCursor()).generate(
      { modelId: "model" },
      { onActivity: outerActivity },
    )).rejects.toMatchObject({ code: "rate_limit" });
    expect(outerActivity).toHaveBeenCalledTimes(1);
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
  it("classifies upstream 5xx failures without exposing the response", () => {
    const error = new APICallError({
      message: "RESPONSE_CANARY",
      url: "https://example.test/v1",
      requestBodyValues: {},
      responseBody: "BODY_CANARY",
      statusCode: 503,
    });
    expect(safeErrorShape(error)).toMatchObject({ code: "provider_failure" });
    expect(JSON.stringify(safeErrorShape(error))).not.toMatch(/RESPONSE_CANARY|BODY_CANARY/);
  });

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
