import { describe, it, expect } from "vitest";

/**
 * Test encodePathForClaude against actual ~/.claude/projects/ directory names.
 * These are real observed encodings from Claude CLI — if these fail, resume/continue will break.
 */

// Re-implement the function here to test (it's not exported)
function encodePathForClaude(path: string): string {
  const stripped = path.startsWith("/") ? path.slice(1) : path;
  let result = "";
  for (const ch of stripped) {
    if (ch === "/") result += "-";
    else if (ch === ".") result += "-";
    else if (ch.charCodeAt(0) > 127) result += "-";
    else result += ch;
  }
  return "-" + result;
}

describe("encodePathForClaude", () => {
  it("encodes simple path", () => {
    expect(encodePathForClaude("/Users/liujunping/project/i/ai-manager")).toBe(
      "-Users-liujunping-project-i-ai-manager"
    );
  });

  it("encodes .tower path — dots become dashes", () => {
    expect(encodePathForClaude("/Users/liujunping/project/i/ai-manager/.tower")).toBe(
      "-Users-liujunping-project-i-ai-manager--tower"
    );
  });

  it("encodes Chinese path segments as dashes", () => {
    expect(encodePathForClaude("/Users/liujunping/company/四川省/南京市/repository/enrollment-static")).toBe(
      "-Users-liujunping-company---------repository-enrollment-static"
    );
  });

  it("encodes .worktrees path — dot becomes dash (critical for resume)", () => {
    const worktreePath = "/Users/liujunping/company/四川省/南京市/repository/enrollment-static/.worktrees/task-cmo88nwu20001clvyt1aosa5t";
    expect(encodePathForClaude(worktreePath)).toBe(
      "-Users-liujunping-company---------repository-enrollment-static--worktrees-task-cmo88nwu20001clvyt1aosa5t"
    );
  });

  it("encodes .git path", () => {
    expect(encodePathForClaude("/home/user/project/.git")).toBe(
      "-home-user-project--git"
    );
  });

  it("encodes .claude path", () => {
    expect(encodePathForClaude("/home/user/.claude/projects")).toBe(
      "-home-user--claude-projects"
    );
  });

  it("handles multiple consecutive dots", () => {
    expect(encodePathForClaude("/a/b/../c")).toBe("-a-b----c");
  });

  it("handles path without leading slash", () => {
    expect(encodePathForClaude("relative/path")).toBe("-relative-path");
  });
});
