// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const TOWER_ID = "as_11111111-1111-4111-8111-111111111111";
const IMPORTED_LEGACY_ID = "22222222-2222-4222-8222-222222222222";
const NEW_LEGACY_ID = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listImportedLegacyIds: vi.fn(),
  getSessionView: vi.fn(),
  getMessages: vi.fn(),
  prepareHistory: vi.fn(),
  getSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  findImportedLegacy: vi.fn(),
  legacyList: vi.fn(),
  legacyImport: vi.fn(),
  legacyRename: vi.fn(),
  legacyDelete: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/internal-api-guard", () => ({ requireLocalhost: () => null }));
vi.mock("@/lib/config-reader", () => ({ readConfigValue: async () => 20 }));
vi.mock("@/lib/ai/assistant-session-service", () => ({
  AssistantSessionError: class AssistantSessionError extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  },
  assistantSessionIdSchema: z.union([z.string().regex(/^as_/), z.string().uuid()]),
  towerSessionIdSchema: z.string().regex(/^as_/),
  legacySessionIdSchema: z.string().uuid(),
  assistantMessagesToClient: (messages: unknown[]) => messages,
  assistantSessionService: {
    listSessions: mocks.listSessions,
    listImportedLegacyIds: mocks.listImportedLegacyIds,
    getSessionView: mocks.getSessionView,
    getMessages: mocks.getMessages,
    prepareHistory: mocks.prepareHistory,
    getSession: mocks.getSession,
    updateSession: mocks.updateSession,
    deleteSession: mocks.deleteSession,
    findImportedLegacy: mocks.findImportedLegacy,
  },
}));
vi.mock("@/lib/ai/assistant-legacy-adapter", () => ({
  assistantLegacyAdapter: {
    list: mocks.legacyList,
    import: mocks.legacyImport,
    rename: mocks.legacyRename,
    delete: mocks.legacyDelete,
  },
}));

import { DELETE, GET, PATCH } from "../route";

function request(query = "", init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost/api/internal/assistant/sessions${query}`, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSessions.mockResolvedValue([{
    id: TOWER_ID,
    title: "Tower",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    lastMessageAt: "2026-01-03T00:00:00.000Z",
  }]);
  mocks.listImportedLegacyIds.mockResolvedValue(new Set([IMPORTED_LEGACY_ID]));
  mocks.legacyList.mockResolvedValue([
    { sessionId: IMPORTED_LEGACY_ID, title: "Already imported", lastModified: Date.parse("2026-01-02") },
    { sessionId: NEW_LEGACY_ID, title: "Legacy", lastModified: Date.parse("2026-01-04") },
  ]);
  mocks.legacyImport.mockResolvedValue({ id: TOWER_ID });
  mocks.getSessionView.mockResolvedValue({ id: TOWER_ID, title: "Legacy" });
  mocks.getMessages.mockResolvedValue([{ id: "message" }]);
  mocks.prepareHistory.mockResolvedValue(undefined);
  mocks.getSession.mockResolvedValue({ id: TOWER_ID, legacySource: "claude-agent-sdk", legacyId: IMPORTED_LEGACY_ID });
  mocks.updateSession.mockResolvedValue({ id: TOWER_ID, title: "Renamed" });
  mocks.findImportedLegacy.mockResolvedValue(null);
  mocks.legacyRename.mockResolvedValue(undefined);
  mocks.legacyDelete.mockResolvedValue(undefined);
  mocks.deleteSession.mockResolvedValue(undefined);
});

describe("Assistant sessions route", () => {
  it("merges DB sessions with only unimported legacy sessions", async () => {
    const payload = await (await GET(request())).json();
    expect(payload.sessions.map((session: { id: string }) => session.id)).toEqual([NEW_LEGACY_ID, TOWER_ID]);
    expect(mocks.listSessions).toHaveBeenCalledWith({ origin: "UI" });
  });

  it("returns gateway-origin sessions without merging legacy disk sessions", async () => {
    const payload = await (await GET(request("?origin=gateway"))).json();
    expect(mocks.listSessions).toHaveBeenCalledWith({ origin: "GATEWAY" });
    expect(mocks.legacyList).not.toHaveBeenCalled();
    expect(payload.sessions.map((session: { id: string }) => session.id)).toEqual([TOWER_ID]);
  });

  it("passes origin=all through and still merges legacy sessions", async () => {
    await GET(request("?origin=all"));
    expect(mocks.listSessions).toHaveBeenCalledWith({ origin: "ALL" });
    expect(mocks.legacyList).toHaveBeenCalled();
  });

  it("imports a legacy session on first read and returns its Tower id", async () => {
    const response = await GET(request(`?sessionId=${NEW_LEGACY_ID}`));
    await expect(response.json()).resolves.toMatchObject({ sessionId: TOWER_ID, messages: [{ id: "message" }] });
    expect(mocks.legacyImport).toHaveBeenCalledWith(NEW_LEGACY_ID, expect.any(Object));
    expect(mocks.prepareHistory).toHaveBeenCalledWith({ sessionId: TOWER_ID, historyTurns: 20 });
    expect(mocks.prepareHistory.mock.invocationCallOrder[0]).toBeLessThan(mocks.getMessages.mock.invocationCallOrder[0]!);
  });

  it("persists a rename and reports a failed legacy-store sync without exposing the error", async () => {
    mocks.legacyRename.mockRejectedValueOnce(new Error("CANARY_SECRET"));
    const response = await PATCH(request(`?sessionId=${TOWER_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed" }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sessionId: TOWER_ID,
      legacySyncWarning: "legacy_rename_failed",
    });
    expect(mocks.updateSession).toHaveBeenCalledWith(TOWER_ID, { title: "Renamed", binding: undefined });
  });

  it("ignores client display names and preserves explicit ID clearing", async () => {
    const nameOnly = await PATCH(request(`?sessionId=${TOWER_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceName: "PROMPT_INJECTION" }),
    }));
    expect(nameOnly.status).toBe(400);
    expect(mocks.updateSession).not.toHaveBeenCalled();

    const cleared = await PATCH(request(`?sessionId=${TOWER_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: null, projectId: null, versionId: null }),
    }));
    expect(cleared.status).toBe(200);
    expect(mocks.updateSession).toHaveBeenCalledWith(TOWER_ID, { title: undefined, binding: {} });
  });

  it("deletes an imported legacy source before its DB session", async () => {
    const response = await DELETE(request(`?sessionId=${TOWER_ID}`, { method: "DELETE" }));
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.legacyDelete.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.deleteSession.mock.invocationCallOrder[0]!);
  });
});
