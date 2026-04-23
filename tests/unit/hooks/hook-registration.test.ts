import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * Tests for Claude hook auto-registration.
 * Reads the actual ~/.claude/settings.json to verify registration.
 *
 * Note: These tests check the real settings file. ensureTowerDir() is
 * called on every dev/start, so running it in test is safe (idempotent).
 */

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

describe("ensureClaudeHooks — Stop hook registration", () => {
  it("should have Stop hook registered after ensureTowerDir", async () => {
    // Import and run — this writes to real settings
    const { ensureTowerDir } = await import("@/lib/init-tower");
    ensureTowerDir();

    const settings = readSettings();
    const hooks = settings["hooks"] as Record<string, unknown>;
    expect(hooks).toBeDefined();

    const stopEntries = hooks["Stop"] as Array<{ hooks: Array<{ command: string }> }>;
    expect(stopEntries).toBeDefined();
    expect(
      stopEntries.some((e) =>
        e.hooks.some((h) => h.command.includes("stop-hook.js"))
      )
    ).toBe(true);
  });

  it("should have all 3 Tower hooks registered", async () => {
    const settings = readSettings();
    const hooks = settings["hooks"] as Record<string, unknown>;

    // SessionStart
    const sessionStart = hooks["SessionStart"] as Array<{ hooks: Array<{ command: string }> }>;
    expect(
      sessionStart?.some((e) =>
        e.hooks.some((h) => h.command.includes("session-start-hook.js"))
      )
    ).toBe(true);

    // PostToolUse
    const postToolUse = hooks["PostToolUse"] as Array<{ hooks: Array<{ command: string }> }>;
    expect(
      postToolUse?.some((e) =>
        e.hooks.some((h) => h.command.includes("post-tool-hook.js"))
      )
    ).toBe(true);

    // Stop
    const stop = hooks["Stop"] as Array<{ hooks: Array<{ command: string }> }>;
    expect(
      stop?.some((e) =>
        e.hooks.some((h) => h.command.includes("stop-hook.js"))
      )
    ).toBe(true);
  });

  it("should not duplicate Stop hook on repeated calls", async () => {
    const { ensureTowerDir } = await import("@/lib/init-tower");

    // Call twice
    ensureTowerDir();
    ensureTowerDir();

    const settings = readSettings();
    const hooks = settings["hooks"] as Record<string, unknown>;
    const stopEntries = hooks["Stop"] as Array<{ hooks: Array<{ command: string }> }>;

    const stopHookCount = stopEntries.filter((e) =>
      e.hooks.some((h) => h.command.includes("stop-hook.js"))
    ).length;

    expect(stopHookCount).toBe(1);
  });
});
