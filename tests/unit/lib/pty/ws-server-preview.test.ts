import { describe, it, expect } from "vitest";
import { parsePreviewWsParams, PREVIEW_TASK_ID } from "@/lib/pty/ws-server";

describe("parsePreviewWsParams", () => {
  it("parses state role", () => {
    const url = new URL(
      `http://x/?taskId=${PREVIEW_TASK_ID}&role=state&previewKey=${encodeURIComponent("/repo|pnpm dev|5173")}&connectionId=c1`
    );
    const r = parsePreviewWsParams(url.searchParams);
    expect(r).toEqual({
      role: "state",
      previewKey: "/repo|pnpm dev|5173",
      connectionId: "c1",
      taskId: null,
    });
  });

  it("parses terminal role with clientTaskId hint", () => {
    const url = new URL(
      `http://x/?taskId=${PREVIEW_TASK_ID}&role=terminal&previewKey=${encodeURIComponent("k")}&connectionId=c2&clientTaskId=t1`
    );
    const r = parsePreviewWsParams(url.searchParams);
    expect(r?.role).toBe("terminal");
    expect(r?.previewKey).toBe("k");
    expect(r?.taskId).toBe("t1");
  });

  it("returns null when taskId is not __preview__", () => {
    const url = new URL("http://x/?taskId=cuid123&role=state");
    expect(parsePreviewWsParams(url.searchParams)).toBeNull();
  });

  it("returns null when previewKey or role missing", () => {
    const url = new URL(`http://x/?taskId=${PREVIEW_TASK_ID}`);
    expect(parsePreviewWsParams(url.searchParams)).toBeNull();
  });

  it("decodes URL-encoded previewKey with | and /", () => {
    const original = "/Users/me/repo/apps/h5|pnpm dev|5173";
    const url = new URL(
      `http://x/?taskId=${PREVIEW_TASK_ID}&role=state&previewKey=${encodeURIComponent(original)}&connectionId=c`
    );
    const r = parsePreviewWsParams(url.searchParams);
    expect(r?.previewKey).toBe(original);
  });
});
