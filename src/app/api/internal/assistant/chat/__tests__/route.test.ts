// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  requests: [] as Array<Record<string, unknown>>,
  apiHistory: [] as Array<Record<string, unknown>>,
  promptBindings: [] as Array<Record<string, unknown>>,
  sessionView: { id: "as_11111111-1111-1111-1111-111111111111" } as Record<string, unknown>,
  attachmentParts: [] as Array<Record<string, unknown>>,
  attachmentError: null as Error | null,
  configError: false,
  createSession: vi.fn(async () => ({ id: "as_11111111-1111-1111-1111-111111111111" })),
  deleteSession: vi.fn(async () => undefined),
  finishTurn: vi.fn(async () => undefined),
  updateAssistantMessage: vi.fn(async () => undefined),
  prepareHistory: vi.fn(async () => undefined),
  getMessages: vi.fn(async () => []),
  releaseTurn: vi.fn(),
  turnController: null as AbortController | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/internal-api-guard", () => ({ requireLocalhost: () => null }));
vi.mock("@/lib/init-tower", () => ({ ensureTowerDir: () => "/tmp/tower-assistant" }));
vi.mock("@/lib/config-reader", () => ({
  readConfigValue: async (_key: string, fallback: unknown) => {
    if (mocks.configError) throw new Error("CONFIG_CANARY");
    return fallback;
  },
}));
vi.mock("@/lib/ai/install-orchestrator", () => ({
  buildTowerMcpConfig: () => ({
    name: "tower-test",
    command: "node",
    args: ["/opt/tower/mcp-server.cjs"],
    env: { TOWER_MCP_PROFILE: "assistant" },
  }),
}));
vi.mock("@/lib/ai/capability-config-service", () => ({ recordCapabilityAttemptService: vi.fn() }));
vi.mock("@/lib/ai/assistant-prompt", () => ({
  buildAssistantSystemPrompt: async (binding: Record<string, unknown>) => {
    mocks.promptBindings.push(binding);
    return "system";
  },
  buildAssistantCliPrompt: (history: unknown, current: unknown) => `CLI:${JSON.stringify(history)}:${String(current)}`,
}));
vi.mock("@/lib/ai/assistant-legacy-adapter", () => ({ assistantLegacyAdapter: { import: vi.fn() } }));
vi.mock("@/lib/ai/assistant-stream-executor", () => ({
  streamAssistantTurn: async function* (request: Record<string, unknown>) {
    mocks.requests.push(request);
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
    MAX_ASSISTANT_MESSAGE_BYTES: 1024 * 1024,
    MAX_ASSISTANT_PARTS: 128,
    MAX_ASSISTANT_STREAM_BYTES: 1024 * 1024 - 8 * 1024,
    assistantSessionIdSchema: z.string(),
    towerSessionIdSchema: tower,
    assistantMessagesToApi: () => mocks.apiHistory,
    trimAssistantHistory: (messages: unknown[]) => messages,
    attachmentParts: async () => {
      if (mocks.attachmentError) throw mocks.attachmentError;
      return mocks.attachmentParts;
    },
    normalizeAssistantParts: (parts: unknown[]) => parts,
    assistantSessionService: {
      createSession: mocks.createSession,
      deleteSession: mocks.deleteSession,
      getSession: async () => ({}),
      updateSession: async () => ({}),
      getMessages: mocks.getMessages,
      getSessionView: async () => mocks.sessionView,
      prepareHistory: mocks.prepareHistory,
      beginTurn: async () => ({
        turnId: "at_11111111-1111-1111-1111-111111111111",
        userMessageId: "am_11111111-1111-1111-1111-111111111111",
        assistantMessageId: "am_22222222-2222-2222-2222-222222222222",
        controller: mocks.turnController!,
      }),
      updateAssistantMessage: mocks.updateAssistantMessage,
      finishTurn: mocks.finishTurn,
      releaseTurn: mocks.releaseTurn,
    },
  };
});

import { POST } from "../route";

function request(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/internal/assistant/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hello", clientTurnId: "client_12345678", ...body }),
  });
}

function events(body: string) {
  return body.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
}

beforeEach(() => {
  mocks.events = [];
  mocks.requests = [];
  mocks.apiHistory = [];
  mocks.promptBindings = [];
  mocks.sessionView = { id: "as_11111111-1111-1111-1111-111111111111" };
  mocks.attachmentParts = [];
  mocks.attachmentError = null;
  mocks.configError = false;
  mocks.turnController = new AbortController();
  mocks.createSession.mockClear();
  mocks.deleteSession.mockClear();
  mocks.finishTurn.mockClear();
  mocks.updateAssistantMessage.mockClear();
  mocks.prepareHistory.mockClear();
  mocks.getMessages.mockClear();
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

  it("preserves a successful tool result when the provider later fails and never emits done", async () => {
    mocks.events = [
      { type: "tool-call", toolCall: { id: "tool-2", name: "create_task", input: { title: "T" } } },
      { type: "tool-result", toolResult: { id: "tool-2", name: "create_task", output: { id: "created" } } },
      { type: "text", text: "partial" },
      { type: "error", error: { code: "provider_failure", message: "Safe failure" } },
    ];
    const parsed = events(await (await POST(request())).text());
    expect(parsed.map((event) => event.type)).toEqual([
      "session", "tool_start", "tool_use", "tool_result", "text_delta", "error",
    ]);
    expect(parsed.some((event) => event.type === "done")).toBe(false);
    expect(mocks.finishTurn).toHaveBeenCalledWith(expect.objectContaining({
      status: "FAILED",
      parts: expect.arrayContaining([
        expect.objectContaining({ type: "tool-result", toolCallId: "tool-2", output: { id: "created" } }),
        expect.objectContaining({ type: "text", text: "partial" }),
        expect.objectContaining({ type: "error", code: "provider_failure" }),
      ]),
    }));
  });

  it("redacts distinct provider canaries from SSE events and persisted parts", async () => {
    const textCanary = "CANARY_SSE_TEXT_9a21";
    const inputCanary = "CANARY_TOOL_INPUT_b613";
    const outputCanary = "CANARY_TOOL_OUTPUT_c824";
    const errorCanary = "CANARY_UPSTREAM_ERROR_d035";
    mocks.events = [
      { type: "text", text: `apiKey=${textCanary}` },
      { type: "reasoning", text: `token=${textCanary}` },
      { type: "tool-call", toolCall: { id: "tool-sec", name: "query", input: { apiKey: inputCanary } } },
      { type: "tool-result", toolResult: { id: "tool-sec", name: "query", output: { secret: outputCanary } } },
      { type: "error", error: { code: "provider_failure", message: `token=${errorCanary}` } },
    ];

    const responseBody = await (await POST(request())).text();
    const persisted = JSON.stringify([
      ...mocks.updateAssistantMessage.mock.calls,
      ...mocks.finishTurn.mock.calls,
    ]);
    for (const canary of [textCanary, inputCanary, outputCanary, errorCanary]) {
      expect(responseBody).not.toContain(canary);
      expect(persisted).not.toContain(canary);
    }
    expect(responseBody).toContain("[REDACTED]");
  });

  it("passes complete history, current attachment metadata, and capability options to the executor", async () => {
    mocks.apiHistory = [
      { role: "user", content: "older user" },
      { role: "assistant", content: [{ type: "text", text: "older assistant" }] },
    ];
    mocks.attachmentParts = [
      { type: "attachment", attachment: "2026-07/files/note.txt", mimeType: "text/plain", size: 12 },
      { type: "attachment", attachment: "2026-07/images/design.png", mimeType: "image/png", size: 34 },
    ];
    mocks.events = [{ type: "text", text: "ok" }, { type: "finish", reason: "stop" }];
    await (await POST(request({
      attachmentFilenames: ["2026-07/files/note.txt", "2026-07/images/design.png"],
    }))).text();

    expect(mocks.requests).toHaveLength(1);
    expect(mocks.requests[0]).toMatchObject({
      prompt: expect.stringContaining("older user"),
      messages: [
        ...mocks.apiHistory,
        {
          role: "user",
          content: expect.stringMatching(/hello[\s\S]*2026-07\/files\/note\.txt[\s\S]*text\/plain[\s\S]*2026-07\/images\/design\.png[\s\S]*image\/png/),
        },
      ],
      attachments: ["2026-07/files/note.txt", "2026-07/images/design.png"],
      systemPrompt: "system",
      maxTurns: 30,
      maxOutputTokens: 128000,
      maxOutputBytes: 1024 * 1024 - 8 * 1024,
      effort: "low",
      towerMcpServer: {
        name: "tower-test",
        command: "node",
        args: ["/opt/tower/mcp-server.cjs"],
        env: { TOWER_MCP_PROFILE: "assistant" },
      },
    });
    expect(String(mocks.requests[0].prompt)).not.toContain("system");
    expect((mocks.requests[0].messages as Array<{ role: string }>).some((message) => message.role === "system")).toBe(false);
    expect(mocks.prepareHistory).toHaveBeenCalledWith({
      sessionId: "as_11111111-1111-1111-1111-111111111111",
      historyTurns: 20,
      reserveBytes: Buffer.byteLength(JSON.stringify([
        { type: "text", text: "hello" },
        ...mocks.attachmentParts,
      ])) + 1024 * 1024,
    });
    expect(mocks.prepareHistory.mock.invocationCallOrder[0]).toBeLessThan(mocks.getMessages.mock.invocationCallOrder[0]!);
  });

  it("keeps the last safe partial and fails without done when streamed output exceeds persistence", async () => {
    const safeText = "a".repeat(700_000);
    mocks.events = [
      { type: "text", text: safeText },
      { type: "reasoning", text: "b".repeat(400_000) },
      { type: "finish", reason: "stop" },
    ];

    const parsed = events(await (await POST(request())).text());

    expect(parsed.map((event) => event.type)).toEqual(["session", "text_delta", "error"]);
    expect(parsed.some((event) => event.type === "done")).toBe(false);
    expect(mocks.turnController?.signal.aborted).toBe(true);
    expect(mocks.finishTurn).toHaveBeenCalledWith(expect.objectContaining({
      status: "FAILED",
      historyTurns: 20,
      parts: [
        { type: "text", text: safeText },
        expect.objectContaining({ type: "error", code: "output_limit" }),
      ],
    }));
  });

  it("validates attachments before creating a new session", async () => {
    mocks.attachmentError = new (class extends Error { code = "invalid_attachment"; })();
    const response = await POST(request({ attachmentFilenames: ["2026-07/files/note.txt"] }));
    expect(response.status).toBe(400);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it("removes a newly created session when configuration fails before beginTurn", async () => {
    mocks.configError = true;
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSession).toHaveBeenCalledWith("as_11111111-1111-1111-1111-111111111111");
  });

  it("uses only server-resolved binding names in the system prompt", async () => {
    mocks.sessionView = {
      id: "as_11111111-1111-1111-1111-111111111111",
      workspaceId: "w1",
      workspaceName: "Real Workspace",
    };
    mocks.events = [{ type: "text", text: "ok" }, { type: "finish", reason: "stop" }];
    await (await POST(request({ workspaceId: "w1", workspaceName: "PROMPT_INJECTION" }))).text();
    expect(mocks.createSession).toHaveBeenCalledWith({ workspaceId: "w1" });
    expect(mocks.promptBindings).toEqual([{ workspaceId: "w1", workspaceName: "Real Workspace" }]);
    expect(JSON.stringify(mocks.requests)).not.toContain("PROMPT_INJECTION");
  });
});
