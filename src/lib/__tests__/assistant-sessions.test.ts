import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLegacyAssistantOverlay,
  getActiveSessionId,
  readLegacyAssistantOverlay,
  setActiveSessionId,
} from "../assistant-sessions";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

describe("Assistant local UI storage", () => {
  it("keeps only the active Tower session as ongoing state", () => {
    setActiveSessionId("as_11111111-1111-1111-1111-111111111111");
    expect(getActiveSessionId()).toBe("as_11111111-1111-1111-1111-111111111111");
    setActiveSessionId(null);
    expect(getActiveSessionId()).toBeNull();
  });

  it("reads and clears the pre-DB title/binding overlay for one-time migration", () => {
    const legacyId = "11111111-1111-4111-8111-111111111111";
    storage.set("tower-assistant-sessions", JSON.stringify([{
      id: legacyId,
      title: "Renamed",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-02T00:00:00.000Z",
    }, null]));
    storage.set("tower-assistant-bindings", JSON.stringify({
      [legacyId]: { projectId: "p1" },
      invalid: { projectId: "ignored" },
    }));
    expect(readLegacyAssistantOverlay()).toEqual({
      sessions: [{
        id: legacyId,
        title: "Renamed",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      }],
      bindings: { [legacyId]: { projectId: "p1" } },
    });
    clearLegacyAssistantOverlay();
    expect(storage.has("tower-assistant-sessions")).toBe(false);
    expect(storage.has("tower-assistant-bindings")).toBe(false);
  });
});
