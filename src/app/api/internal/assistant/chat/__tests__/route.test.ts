// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  finishTurn: vi.fn(async () => undefined),
  updateAssistantMessage: vi.fn(async () => undefined),
  releaseTurn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/internal-api-guard", () => ({ requireLocalhost: () => null }));
vi.mock("@/lib/init-tower", () => ({ ensureTowerDir: () => "/tmp/tower-assistant" }));
vi.mock("@/lib/config-reader", () => ({ readConfigValue: async (_key: string, fallback: unknown) => fallback }));
vi.mock("@/lib/ai/install-orchestrator", () => ({ buildTowerMcpConfig: () => ({ name: "tower-test" }) }));
vi.mock("@/lib/ai/capability-config-service", () => ({ recordCapabilityAttemptService: vi.fn() }));
vi.mock("@/lib/ai/assistant-prompt", () => ({
  buildAssistantSystemPrompt: async () => "system",
  buildAssistantCliPrompt: () => "prompt",
}));
vi.mock("@/lib/ai/assistant-legacy-adapter", () => ({ assistantLegacyAdapter: { import: vi.fn() } }));
vi.mock("@/lib/ai/assistant-stream-executor", () => ({
  streamAssistantTurn: async function* () {
    for (const event of mocks.events) yield event;
  },
}));
vi.mock("@/lib/ai/assistant-session-service", () => {
  class AssistantSessionError extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  }
  const tower = z.string().regex(/^as_/);
  return {
    AssistantSessionError,
    assistantSessionIdSchema: z.string(),
    towerSessionIdSchema: tower,
    assistantMessagesToApi: () => [],
    trimAssistantHistory: (messages: unknown[]) => messages,
    attachmentParts: async () => [],
    normalizeAssistantParts: (parts: unknown[]) => parts,
    redactAssistantValue: (value: unknown) => value,
    assistantSessionService: {
      createSession: async () => ({ id: "as_11111111-1111-1111-1111-111111111111" }),
      getSession: async () => ({}),
      updateSession: async () => ({}),
      getMessages: async () => [],
      getSessionView: async () => ({ id: "as_11111111-1111-1111-1111-111111111111" }),
      beginTurn: async () => ({
        turnId: "at_11111111-1111-1111-1111-111111111111",
        userMessageId: "am_11111111-1111-1111-1111-111111111111",
        assistantMessageId: "am_22222222-2222-2222-2222-222222222222",
        controller: new AbortController(),
      }),
      updateAssistantMessage: mocks.updateAssistantMessage,
      finishTurn: mocks.finishTurn,
      releaseTurn: mocks.releaseTurn,
    },
  };
});

import { POST } from "../route";

function request() {
  return new NextRequest("http://localhost/api/internal/assistant/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hello", clientTurnId: "client_12345678" }),
  });
}

function events(body: string) {
  return body.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
}

beforeEach(() => {
  mocks.events = [];
  mocks.finishTurn.mockClear();
  mocks.updateAssistantMessage.mockClear();
  mocks.releaseTurn.mockClear();
});

describe("Assistant chat SSE route", () => {
  it("keeps compatible event ordering and sends done only after persistence", async () => {
    mocks.events = [
      { type: "tool-call", toolCall: { id: "tool-1", name: "create_task", input: { title: "T" } } },
      { type: "tool-result", toolResult: { id: "tool-1", name: "create_task", output: { id: "t1" } } },
      { type: "text", text: "Created" },
      { type: "finish", reason: "stop" },
    ];
    const response = await POST(request());
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const parsed = events(await response.text());
    expect(parsed.map((event) => event.type)).toEqual([
      "session", "tool_start", "tool_use", "tool_result", "text_delta", "finish", "done",
    ]);
    expect(parsed.filter((event) => event.toolId === "tool-1")).toHaveLength(3);
    expect(mocks.finishTurn).toHaveBeenCalledWith(expect.objectContaining({ status: "COMPLETE" }));
    expect(mocks.finishTurn.mock.invocationCallOrder[0]).toBeLessThan(mocks.releaseTurn.mock.invocationCallOrder[0]!);
  });

  it("persists partial failed output, emits error, and never emits done", async () => {
    mocks.events = [
      { type: "text", text: "partial" },
      { type: "error", error: { code: "provider_failure", message: "Safe failure" } },
    ];
    const parsed = events(await (await POST(request())).text());
    expect(parsed.map((event) => event.type)).toEqual(["session", "text_delta", "error"]);
    expect(mocks.finishTurn).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED" }));
  });
});
