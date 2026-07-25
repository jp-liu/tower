import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: { systemConfig: { findUnique: vi.fn(async () => ({ value: JSON.stringify("Liu") })) } },
}));

import { buildAssistantCliPrompt, buildAssistantSystemPrompt } from "../assistant-prompt";

describe("provider-neutral Assistant prompt", () => {
  it("applies the same Tower contract, identity, and soft scope to every provider", async () => {
    const prompt = await buildAssistantSystemPrompt({
      workspaceId: "w1", workspaceName: "Workspace",
      projectId: "p1", projectName: "Project",
      versionId: "v1", versionName: "0.3",
    });
    expect(prompt).toContain("Tower's task-management operator");
    expect(prompt).toContain("create_task");
    expect(prompt).toContain("The user's name is \"Liu\"");
    expect(prompt).toContain("versionId=v1");
    expect(prompt).toContain("Global requests");
    expect(prompt).not.toMatch(/\/tower|SKILL\.md|SKILL_REMINDER/);
  });

  it("replays bounded Tower history once for stateless CLI turns", () => {
    const prompt = buildAssistantCliPrompt([
      { role: "user", content: "first" },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
    ], "second");
    expect(prompt.match(/Conversation history/g)).toHaveLength(1);
    expect(prompt).toContain("USER: first");
    expect(prompt).toContain("ASSISTANT: answer");
    expect(prompt).toContain("CURRENT USER: second");
    expect(prompt).not.toContain("Tower's task-management operator");
    expect(prompt).not.toMatch(/\/tower|SKILL\.md|SKILL_REMINDER/);
  });
});
