import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    providerConnection: { findMany: vi.fn() },
    aiCapabilityConfig: { findUnique: vi.fn(), findMany: vi.fn() },
    aiCapabilityTarget: {},
    aiCapabilityAttempt: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { db } from "@/lib/db";
import {
  listCapabilityConfigsService,
  recordCapabilityAttemptService,
  replaceCapabilityTargetsService,
} from "../capability-config-service";

const mockDb = db as unknown as {
  providerConnection: { findMany: ReturnType<typeof vi.fn> };
  aiCapabilityConfig: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
  aiCapabilityAttempt: { create: ReturnType<typeof vi.fn> };
};

describe("capability config service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.aiCapabilityConfig.findUnique.mockResolvedValue(null);
  });

  it("always lists exactly the five supported slots", async () => {
    mockDb.aiCapabilityConfig.findMany.mockResolvedValue([]);
    expect((await listCapabilityConfigsService()).map((config) => config.slot)).toEqual([
      "terminal",
      "summary",
      "dreaming",
      "analysis",
      "assistant",
    ]);
  });

  it("rejects API targets for terminal", async () => {
    mockDb.providerConnection.findMany.mockResolvedValue([
      { id: "api", kind: "api", provider: "openai" },
    ]);
    await expect(replaceCapabilityTargetsService("terminal", [
      { connectionId: "api", modelId: "gpt" },
    ])).rejects.toMatchObject({ code: "connection_kind_not_allowed" });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("accepts CLI and API targets for non-terminal slots but requires API models", async () => {
    mockDb.providerConnection.findMany.mockResolvedValue([
      { id: "cli", kind: "cli", provider: "claude" },
      { id: "api", kind: "api", provider: "openai" },
    ]);
    await expect(replaceCapabilityTargetsService("summary", [
      { connectionId: "api" },
    ])).rejects.toMatchObject({ code: "model_required" });
  });

  it("rejects equivalent duplicate connection and model targets", async () => {
    mockDb.providerConnection.findMany.mockResolvedValue([
      { id: "cli", kind: "cli", provider: "claude" },
    ]);
    await expect(replaceCapabilityTargetsService("assistant", [
      { connectionId: "cli", modelId: null },
      { connectionId: "cli", modelId: "" },
    ])).rejects.toMatchObject({ code: "duplicate_target" });
  });

  it("replaces and continuously orders the whole plan in one transaction", async () => {
    mockDb.providerConnection.findMany.mockResolvedValue([
      { id: "cli", kind: "cli", provider: "claude" },
      { id: "api", kind: "api", provider: "openai" },
    ]);
    const transaction = {
      aiCapabilityConfig: {
        upsert: vi.fn().mockResolvedValue({ id: "config" }),
      },
      aiCapabilityTarget: {
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
    };
    mockDb.$transaction.mockImplementation(async (callback) => callback(transaction));
    await replaceCapabilityTargetsService("analysis", [
      { targetId: "one", connectionId: "cli" },
      { targetId: "two", connectionId: "api", modelId: "model" },
    ]);
    expect(transaction.aiCapabilityTarget.deleteMany).toHaveBeenCalledTimes(1);
    expect(transaction.aiCapabilityTarget.create.mock.calls.map((call) => call[0].data.order))
      .toEqual([0, 1]);
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });

  it("persists only the safe diagnostic allowlist", async () => {
    const attempt = {
      requestId: "request",
      correlationId: "correlation",
      slot: "assistant" as const,
      targetId: "target",
      connectionId: "connection",
      modelId: "model",
      startedAt: new Date(0),
      durationMs: 12,
      result: "failed" as const,
      errorCode: "authentication" as const,
      prompt: "PROMPT_CANARY",
      apiKey: "KEY_CANARY",
      header: "HEADER_CANARY",
      query: "QUERY_CANARY",
      response: "RESPONSE_CANARY",
    };
    await recordCapabilityAttemptService(attempt);
    const serialized = JSON.stringify(mockDb.aiCapabilityAttempt.create.mock.calls[0]?.[0]);
    for (const canary of [
      "PROMPT_CANARY",
      "KEY_CANARY",
      "HEADER_CANARY",
      "QUERY_CANARY",
      "RESPONSE_CANARY",
    ]) expect(serialized).not.toContain(canary);
  });
});
