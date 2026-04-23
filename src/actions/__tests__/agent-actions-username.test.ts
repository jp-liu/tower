import { describe, it, expect } from "vitest";

/**
 * Mirrors the username injection logic used in startPtyExecution,
 * resumePtyExecution, and continueLatestPtyExecution in agent-actions.ts.
 *
 * This helper is self-contained so tests pass independently of the
 * full PTY spawn infrastructure.
 */
function buildUsernameArgs(username: string | null): string[] {
  if (!username) return [];
  return ["--append-system-prompt", `The user's name is ${username}.`];
}

describe("buildUsernameArgs", () => {
  it("returns the correct --append-system-prompt args for a valid username", () => {
    expect(buildUsernameArgs("Alice")).toEqual([
      "--append-system-prompt",
      "The user's name is Alice.",
    ]);
  });

  it("returns empty array for empty string username", () => {
    expect(buildUsernameArgs("")).toEqual([]);
  });

  it("returns empty array for null username", () => {
    expect(buildUsernameArgs(null)).toEqual([]);
  });
});
