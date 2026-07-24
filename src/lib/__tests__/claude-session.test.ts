// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  structured: vi.fn(),
  text: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/capability-executor", () => ({
  generateCapabilityStructured: mocks.structured,
  generateCapabilityText: mocks.text,
}));

import { generateDreamingInsight, generateSummaryFromLog } from "../claude-session";

describe("background capability prompts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the summary slot and preserves terminal truncation", async () => {
    mocks.text.mockResolvedValue("  summary  ");
    await expect(generateSummaryFromLog(`old${"x".repeat(6000)}`, "/work", "exec"))
      .resolves.toBe("summary");
    expect(mocks.text).toHaveBeenCalledWith(expect.objectContaining({
      slot: "summary",
      cwd: "/work",
      correlationId: "exec",
      prompt: expect.not.stringContaining("old"),
    }));
  });

  it("strictly rejects malformed dreaming fields", async () => {
    mocks.structured.mockImplementation(async (request) => request.parse({
      summary: "done",
      insights: [{ type: "invented", content: "bad" }],
      shouldCreateNote: "yes",
      extra: true,
    }));
    await expect(generateDreamingInsight("log", "/work", null)).rejects.toThrow();
  });

  it("accepts a strict dreaming result through the dreaming slot", async () => {
    const valid = {
      summary: "done",
      insights: [{ type: "decision", content: "Keep the boundary explicit." }],
      shouldCreateNote: true,
      noteTitle: "Boundary decision",
    };
    mocks.structured.mockImplementation(async (request) => request.parse(valid));
    await expect(generateDreamingInsight("log", "/work", "summary", "task"))
      .resolves.toEqual(valid);
    expect(mocks.structured).toHaveBeenCalledWith(expect.objectContaining({
      slot: "dreaming",
      correlationId: "task",
      schemaName: "tower_dreaming_insight",
    }));
  });
});
