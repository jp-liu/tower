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

  // 注：handlePreviewWs 完整集成测试需要起真实 WS server + PreviewSession，
  // 留作集成测试。此处仅验证 parsePreviewWsParams 没 regression。
  it("still parses params correctly after C-2 fix", () => {
    const url = new URL(
      `http://x/?taskId=${PREVIEW_TASK_ID}&role=state&previewKey=${encodeURIComponent("k")}&connectionId=c`
    );
    expect(parsePreviewWsParams(url.searchParams)?.previewKey).toBe("k");
  });
});
