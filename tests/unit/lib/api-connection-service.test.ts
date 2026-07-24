import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  testConnection: vi.fn(),
  listModels: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@tower/ai-runtime", async () => {
  const actual = await vi.importActual<typeof import("@tower/ai-runtime")>("@tower/ai-runtime");
  return {
    ...actual,
    createApiAdapter: vi.fn(() => ({
      testConnection: runtimeMocks.testConnection,
      listModels: runtimeMocks.listModels,
      generate: runtimeMocks.generate,
    })),
  };
});

import { ApiRuntimeError } from "@tower/ai-runtime";
import { db } from "@/lib/db";
import {
  addApiKeyService,
  addManualApiModelService,
  createApiConnectionService,
  getApiConnectionService,
  getApiRuntimeService,
  refreshApiModelsService,
  reorderApiKeysService,
  testApiConnectionService,
  testApiKeyService,
} from "@/lib/ai/api-connection-service";

async function cleanup() {
  await db.providerConnection.deleteMany({ where: { kind: "api" } });
}

async function createConnection(name = "Local API") {
  return createApiConnectionService({
    name,
    protocol: "openai-compatible",
    baseUrl: "  http://localhost:11434/custom/v2/// ",
    defaultModelId: "local-model",
    enabled: true,
    headers: [{
      id: "header-1",
      name: "X-Workspace-Token",
      value: "FULL_HEADER_VALUE",
      enabled: true,
      sensitive: false,
    }],
    queryParams: [],
  });
}

describe("API connection service", () => {
  beforeEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });
  afterAll(cleanup);

  it("creates multiple instances of one protocol and returns complete local values", async () => {
    const first = await createConnection("First");
    const second = await createConnection("Second");
    expect(first.id).not.toBe(second.id);
    expect(first.provider).toBe("openai-compatible");
    expect(first.baseUrl).toBe("http://localhost:11434/custom/v2");
    expect(first.headers[0]).toMatchObject({
      id: "header-1",
      value: "FULL_HEADER_VALUE",
      sensitive: true,
    });
  });

  it("supports full-value multi-key CRUD and stable ordering", async () => {
    const connection = await createConnection();
    const first = await addApiKeyService(connection.id, {
      label: "primary",
      value: "FULL_KEY_A",
      enabled: true,
    });
    const second = await addApiKeyService(connection.id, {
      label: "secondary",
      value: "FULL_KEY_B",
      enabled: true,
    });
    await reorderApiKeysService(connection.id, [second.id, first.id]);
    const stored = await getApiConnectionService(connection.id);
    expect(stored.apiKeys.map((key) => [key.id, key.value, key.order])).toEqual([
      [second.id, "FULL_KEY_B", 0],
      [first.id, "FULL_KEY_A", 1],
    ]);
  });

  it("atomically reserves different starting keys for concurrent calls", async () => {
    const connection = await createConnection();
    const first = await addApiKeyService(connection.id, { value: "KEY_A", enabled: true });
    const second = await addApiKeyService(connection.id, { value: "KEY_B", enabled: true });
    await db.apiConnectionKey.updateMany({
      where: { connectionId: connection.id },
      data: { testStatus: "ok" },
    });
    await db.providerConnection.update({
      where: { id: connection.id },
      data: { testOk: true, testStatus: "connected" },
    });
    runtimeMocks.generate.mockImplementation(async (_request, context) => ({
      text: context.credential.id,
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
    }));

    const runtime = await getApiRuntimeService(connection.id);
    const results = await Promise.all([
      runtime.generate({ modelId: "local-model", prompt: "one" }),
      runtime.generate({ modelId: "local-model", prompt: "two" }),
    ]);
    expect(results.map((result) => result.text)).toEqual([first.id, second.id]);
    const cursor = await db.providerConnection.findUnique({
      where: { id: connection.id },
      select: { roundRobinCursor: true },
    });
    expect(cursor?.roundRobinCursor).toBe(2);
  });

  it("aggregates per-key tests into partial and connected states", async () => {
    const connection = await createConnection();
    const first = await addApiKeyService(connection.id, { value: "KEY_A", enabled: true });
    const second = await addApiKeyService(connection.id, { value: "KEY_B", enabled: true });
    runtimeMocks.testConnection
      .mockResolvedValueOnce({ text: "OK" })
      .mockRejectedValueOnce(new ApiRuntimeError({
        code: "authentication",
        message: "Authentication failed",
        status: 401,
        cause: "HTTPError",
        retryableWithNextKey: true,
      }));

    await testApiConnectionService(connection.id);
    let stored = await getApiConnectionService(connection.id);
    expect(stored.testStatus).toBe("partial");
    expect(stored.testOk).toBe(true);
    expect(stored.apiKeys.map((key) => [key.id, key.testStatus, key.lastError])).toEqual([
      [first.id, "ok", null],
      [second.id, "failed", "Authentication failed"],
    ]);

    runtimeMocks.testConnection.mockResolvedValueOnce({ text: "OK" });
    await testApiKeyService(connection.id, second.id);
    stored = await getApiConnectionService(connection.id);
    expect(stored.testStatus).toBe("connected");
  });

  it("tests a zero-key local connection as one anonymous candidate", async () => {
    const connection = await createConnection();
    runtimeMocks.testConnection.mockResolvedValueOnce({ text: "OK" });
    await testApiConnectionService(connection.id);
    const stored = await getApiConnectionService(connection.id);
    expect(stored.testStatus).toBe("connected");
    expect(runtimeMocks.testConnection.mock.calls[0]?.[1]).toEqual({ id: "anonymous", value: "" });
  });

  it("marks a connection with only disabled keys unavailable", async () => {
    const connection = await createConnection();
    await addApiKeyService(connection.id, { value: "DISABLED_KEY", enabled: false });
    await testApiConnectionService(connection.id);
    const stored = await getApiConnectionService(connection.id);
    expect(stored.testStatus).toBe("unavailable");
    expect(stored.testOk).toBe(false);
    expect(runtimeMocks.testConnection).not.toHaveBeenCalled();
  });

  it("keeps manual models and marks missing discovered models unavailable", async () => {
    const connection = await createConnection();
    await addManualApiModelService(connection.id, "manual-model");
    await db.apiConnectionModel.create({
      data: { connectionId: connection.id, modelId: "stale-model", source: "discovered" },
    });
    runtimeMocks.listModels.mockResolvedValueOnce({
      ok: true,
      models: [
        { id: "manual-model", capabilities: { tools: true }, metadata: { owner: "upstream" } },
        { id: "fresh-model" },
      ],
    });

    await refreshApiModelsService(connection.id);
    const models = await db.apiConnectionModel.findMany({
      where: { connectionId: connection.id },
      orderBy: { modelId: "asc" },
    });
    expect(models.map((model) => [model.modelId, model.source, model.available])).toEqual([
      ["fresh-model", "discovered", true],
      ["manual-model", "manual", true],
      ["stale-model", "discovered", false],
    ]);
    expect(models.find((model) => model.modelId === "manual-model")?.capabilitiesJson).toBe(
      JSON.stringify({ tools: true }),
    );
  });
});
