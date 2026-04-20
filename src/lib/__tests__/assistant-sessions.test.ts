// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  getSessions,
  addSession,
  updateSession,
  deleteSession,
  getActiveSessionId,
  setActiveSessionId,
  buildSessionTitle,
  type AssistantSession,
} from "../assistant-sessions";

function makeSession(id: string, title = "Test Session"): AssistantSession {
  return {
    id,
    title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const STORAGE_KEY = "tower-assistant-sessions";
const ACTIVE_KEY = "tower-assistant-active-session";

describe("getSessions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns [] when localStorage is empty", () => {
    expect(getSessions()).toEqual([]);
  });

  it("returns parsed array when localStorage has valid JSON", () => {
    const sessions = [makeSession("s1"), makeSession("s2")];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    expect(getSessions()).toHaveLength(2);
    expect(getSessions()[0].id).toBe("s1");
  });

  it("returns [] when localStorage has invalid JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(getSessions()).toEqual([]);
  });

  it("returns [] when localStorage has non-array JSON (object)", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: "s1" }));
    expect(getSessions()).toEqual([]);
  });

  it("returns [] when localStorage has non-array JSON (string)", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("just a string"));
    expect(getSessions()).toEqual([]);
  });
});

describe("addSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds a session when list is empty", () => {
    addSession(makeSession("s1"));
    expect(getSessions()).toHaveLength(1);
    expect(getSessions()[0].id).toBe("s1");
  });

  it("prepends new session before existing ones", () => {
    addSession(makeSession("s1"));
    addSession(makeSession("s2"));
    const sessions = getSessions();
    expect(sessions[0].id).toBe("s2");
    expect(sessions[1].id).toBe("s1");
  });

  it("deduplicates by id (re-adding same id moves it to front)", () => {
    addSession(makeSession("s1"));
    addSession(makeSession("s2"));
    addSession(makeSession("s1")); // s1 should be at front, no duplicate
    const sessions = getSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe("s1");
    expect(sessions[1].id).toBe("s2");
  });

  it("caps at MAX_SESSIONS (20) — oldest is dropped when 21st session added", () => {
    // Add 20 sessions (ids s1..s20)
    for (let i = 1; i <= 20; i++) {
      addSession(makeSession(`s${i}`));
    }
    expect(getSessions()).toHaveLength(20);

    // Add the 21st — should drop the oldest (s1, which is at the tail)
    addSession(makeSession("s21"));
    const sessions = getSessions();
    expect(sessions).toHaveLength(20);
    expect(sessions[0].id).toBe("s21");
    // s1 was added first, so after 20 prepends it's at the tail and gets dropped
    const ids = sessions.map((s) => s.id);
    expect(ids).not.toContain("s1");
  });

  it("respects MAX_SESSIONS cap even when deduplication occurs", () => {
    for (let i = 1; i <= 20; i++) {
      addSession(makeSession(`s${i}`));
    }
    // Re-add s10 — dedup means no new entry; count stays 20
    addSession(makeSession("s10"));
    expect(getSessions()).toHaveLength(20);
    expect(getSessions()[0].id).toBe("s10");
  });
});

describe("updateSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("merges updates into the target session", () => {
    addSession(makeSession("s1", "Original Title"));
    updateSession("s1", { title: "Updated Title" });
    const sessions = getSessions();
    expect(sessions[0].title).toBe("Updated Title");
  });

  it("sets updatedAt to a new ISO timestamp", async () => {
    const before = new Date().toISOString();
    addSession(makeSession("s1"));
    // Small delay to ensure timestamp changes
    await new Promise((r) => setTimeout(r, 5));
    updateSession("s1", { title: "New" });
    const updated = getSessions()[0].updatedAt;
    expect(updated >= before).toBe(true);
  });

  it("does not affect other sessions", () => {
    addSession(makeSession("s1", "Title 1"));
    addSession(makeSession("s2", "Title 2"));
    updateSession("s2", { title: "Changed" });
    const sessions = getSessions();
    const s1 = sessions.find((s) => s.id === "s1")!;
    expect(s1.title).toBe("Title 1");
  });

  it("is a no-op when session id does not exist", () => {
    addSession(makeSession("s1"));
    updateSession("nonexistent", { title: "Ghost" });
    expect(getSessions()).toHaveLength(1);
    expect(getSessions()[0].title).toBe("Test Session");
  });
});

describe("deleteSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes the session with the matching id", () => {
    addSession(makeSession("s1"));
    addSession(makeSession("s2"));
    deleteSession("s1");
    const sessions = getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("s2");
  });

  it("is a no-op when session id does not exist", () => {
    addSession(makeSession("s1"));
    deleteSession("nonexistent");
    expect(getSessions()).toHaveLength(1);
  });

  it("clears the active session id if the deleted session was active", () => {
    addSession(makeSession("s1"));
    setActiveSessionId("s1");
    expect(getActiveSessionId()).toBe("s1");
    deleteSession("s1");
    expect(getActiveSessionId()).toBeNull();
  });

  it("does not clear active session when a different session is deleted", () => {
    addSession(makeSession("s1"));
    addSession(makeSession("s2"));
    setActiveSessionId("s2");
    deleteSession("s1");
    expect(getActiveSessionId()).toBe("s2");
  });
});

describe("getActiveSessionId / setActiveSessionId", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when no active session is set", () => {
    expect(getActiveSessionId()).toBeNull();
  });

  it("stores and retrieves the active session id", () => {
    setActiveSessionId("s42");
    expect(getActiveSessionId()).toBe("s42");
  });

  it("removes the active session key when null is passed", () => {
    setActiveSessionId("s42");
    setActiveSessionId(null);
    expect(getActiveSessionId()).toBeNull();
    // Confirm the key is fully removed (not set to string "null")
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
  });

  it("overwrites previous active session id", () => {
    setActiveSessionId("s1");
    setActiveSessionId("s2");
    expect(getActiveSessionId()).toBe("s2");
  });
});

describe("buildSessionTitle", () => {
  it("returns the message as-is when it is <=30 chars", () => {
    expect(buildSessionTitle("Hello world")).toBe("Hello world");
  });

  it("truncates to exactly 30 characters when input exceeds 30 chars", () => {
    const long = "A".repeat(40);
    const result = buildSessionTitle(long);
    expect(result).toHaveLength(30);
    expect(result).toBe("A".repeat(30));
  });

  it("returns 'New Session' for empty string", () => {
    expect(buildSessionTitle("")).toBe("New Session");
  });

  it("returns 'New Session' for whitespace-only string", () => {
    expect(buildSessionTitle("   ")).toBe("New Session");
    expect(buildSessionTitle("\t\n")).toBe("New Session");
  });

  it("trims leading/trailing whitespace before checking length", () => {
    // " Hello " → trimmed to "Hello" (5 chars) — should not truncate
    expect(buildSessionTitle("  Hello  ")).toBe("Hello");
  });

  it("truncates based on trimmed length, not raw length", () => {
    // 30 x chars padded: trimmed is exactly 30 — no truncation
    const exactly30 = "x".repeat(30);
    expect(buildSessionTitle(`  ${exactly30}  `)).toBe(exactly30);
  });

  it("returns 'New Session' when string has exactly 30 chars after trim (not empty)", () => {
    // Edge: exactly 30 chars after trim should NOT be treated as empty
    const exactly30 = "x".repeat(30);
    expect(buildSessionTitle(exactly30)).toBe(exactly30);
  });
});
