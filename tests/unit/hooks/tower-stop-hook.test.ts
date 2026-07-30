import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { childStopDedupKey } from "@/lib/workbench/coordinator";

const require = createRequire(import.meta.url);
const { extractLastAssistant, resolveTurnEventId } = require("../../../scripts/tower-stop-hook.js") as {
  extractLastAssistant(path: string): { text: string; eventId: string };
  resolveTurnEventId(data: unknown, transcriptEventId: string): string;
};
const tempDirs: string[] = [];

async function transcript(records: object[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tower-stop-hook-"));
  tempDirs.push(dir);
  const path = join(dir, "transcript.jsonl");
  await writeFile(path, records.map((record) => JSON.stringify(record)).join("\n"));
  return path;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Tower stop hook transcript identity", () => {
  it("uses Codex's stable turn_id before the unstable transcript fallback", () => {
    expect(resolveTurnEventId({ turn_id: "turn-codex-1" }, "transcript-record-1"))
      .toBe("turn-codex-1");
    expect(resolveTurnEventId({}, "transcript-record-1")).toBe("transcript-record-1");
  });

  it("deduplicates retries of the same tool-only assistant turn", async () => {
    const path = await transcript([{
      uuid: "assistant-tool-turn-1",
      message: { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "Read" }] },
    }]);

    const first = extractLastAssistant(path);
    const retry = extractLastAssistant(path);
    const key = (eventId: string) => childStopDedupKey({
      taskId: "child-a",
      sessionId: "session-1",
      eventId,
      kind: "CHILD_REVIEW_REQUIRED",
    });

    expect(first).toEqual({ text: "", eventId: "assistant-tool-turn-1" });
    expect(key(retry.eventId)).toBe(key(first.eventId));
  });

  it("does not deduplicate two different tool-only assistant turns in one session", async () => {
    const firstPath = await transcript([{
      message: { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "Read" }] },
    }]);
    const secondPath = await transcript([
      {
        message: { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "Read" }] },
      },
      {
        message: { role: "assistant", content: [{ type: "tool_use", id: "tool-2", name: "Bash" }] },
      },
    ]);

    const first = extractLastAssistant(firstPath);
    const second = extractLastAssistant(secondPath);
    const key = (eventId: string) => childStopDedupKey({
      taskId: "child-a",
      sessionId: "session-1",
      eventId,
      kind: "CHILD_REVIEW_REQUIRED",
    });

    expect(first.text).toBe("");
    expect(second.text).toBe("");
    expect(first.eventId).toMatch(/^[a-f0-9]{64}$/);
    expect(second.eventId).toMatch(/^[a-f0-9]{64}$/);
    expect(key(second.eventId)).not.toBe(key(first.eventId));
  });
});
