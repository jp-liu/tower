import { describe, it, expect } from "vitest";
import {
  buildFallbackSummary,
  buildNoteTitle,
  formatNoteContent,
  type TaskChangeData,
} from "@/lib/task-overview-format";

function makeData(overrides: Partial<TaskChangeData> = {}): TaskChangeData {
  return {
    taskId: "ckabc123def456ghi789jkl",
    taskTitle: "修复登录超时",
    projectId: "proj-1",
    projectName: "Tower",
    files: [
      { filename: "src/auth/login.ts", added: 12, removed: 3, isBinary: false, patch: "" },
      { filename: "docs/logo.png", added: 0, removed: 0, isBinary: true, patch: "" },
    ],
    commitLog: "abc123 fix: login timeout\ndef456 chore: bump dep",
    commitCount: 2,
    diffText: "diff --git ...",
    assets: [
      { filename: "api-spec.md", description: "接口文档" },
      { filename: "screenshot.png", description: null },
    ],
    cwd: "/tmp/repo",
    ...overrides,
  };
}

describe("buildFallbackSummary", () => {
  it("returns null for empty/null logs", () => {
    expect(buildFallbackSummary(null)).toBeNull();
    expect(buildFallbackSummary("")).toBeNull();
    expect(buildFallbackSummary("\n\n")).toBeNull();
  });

  it("strips the short hash for a single commit", () => {
    expect(buildFallbackSummary("abc123 fix: login timeout")).toBe("fix: login timeout");
  });

  it("summarizes multiple commits with a count prefix", () => {
    expect(buildFallbackSummary("abc123 fix: a\ndef456 feat: b")).toBe("2 个提交：fix: a");
  });
});

describe("formatNoteContent", () => {
  it("includes all required sections", () => {
    const md = formatNoteContent(makeData(), "做了登录修复。", "2026-06-12T10:00:00.000Z");
    expect(md).toContain("## 改动摘要");
    expect(md).toContain("做了登录修复。");
    expect(md).toContain("## 文件清单");
    expect(md).toContain("## 相关附件与参考资料");
  });

  it("renders the file list with +/- counts and marks binary files", () => {
    const md = formatNoteContent(makeData(), "s", "t");
    expect(md).toContain("`src/auth/login.ts` (+12 / -3)");
    expect(md).toContain("`docs/logo.png`（二进制）");
    expect(md).toContain("共 2 个文件、2 个提交。");
  });

  it("lists commits with sha and message", () => {
    const md = formatNoteContent(makeData(), "s", "t");
    expect(md).toContain("## 提交记录");
    expect(md).toContain("- `abc123` fix: login timeout");
    expect(md).toContain("- `def456` chore: bump dep");
  });

  it("omits the commit section when there is no commit log", () => {
    expect(formatNoteContent(makeData({ commitLog: null }), "s", "t")).not.toContain("## 提交记录");
    expect(formatNoteContent(makeData({ commitLog: "" }), "s", "t")).not.toContain("## 提交记录");
  });

  it("truncates the commit list past 50 entries", () => {
    const commitLog = Array.from({ length: 62 }, (_, i) => `sha${i} commit ${i}`).join("\n");
    const md = formatNoteContent(makeData({ commitLog }), "s", "t");
    expect(md).toContain("- `sha49` commit 49");
    expect(md).not.toContain("- `sha50` commit 50");
    expect(md).toContain("- …其余 12 个提交");
  });

  it("renders assets with and without descriptions", () => {
    const md = formatNoteContent(makeData(), "s", "t");
    expect(md).toContain("- api-spec.md — 接口文档");
    expect(md).toContain("- screenshot.png");
  });

  it("shows (无) when there are no assets", () => {
    const md = formatNoteContent(makeData({ assets: [] }), "s", "t");
    expect(md).toContain("（无）");
  });

  it("back-links the task id, title, project and timestamp", () => {
    const md = formatNoteContent(makeData(), "s", "2026-06-12T10:00:00.000Z");
    expect(md).toContain("关联任务：修复登录超时 (`ckabc123def456ghi789jkl`)");
    expect(md).toContain("项目：Tower");
    expect(md).toContain("生成时间：2026-06-12T10:00:00.000Z");
  });

  it("degrades gracefully when no file list is available", () => {
    const md = formatNoteContent(
      makeData({ files: [], commitCount: 3 }),
      null,
      "t"
    );
    expect(md).toContain("（未能生成改动摘要）");
    expect(md).toContain("未能获取精确文件清单，本次约 3 个提交。");
  });

  it("uses a completion intro for done overviews (default)", () => {
    const md = formatNoteContent(makeData(), "s", "t");
    expect(md).toContain("本笔记由任务完成时自动生成");
    expect(md).not.toContain("任务取消时");
  });

  it("uses a cancellation intro for cancelled overviews", () => {
    const md = formatNoteContent(makeData(), "s", "t", "cancelled");
    expect(md).toContain("本笔记由任务取消时自动生成");
    expect(md).toContain("作为下次重启该任务的参考经验");
  });
});

describe("buildNoteTitle", () => {
  it("prefixes done overviews", () => {
    expect(buildNoteTitle("修复登录", "done")).toBe("任务概览：修复登录");
    expect(buildNoteTitle("修复登录")).toBe("任务概览：修复登录");
  });

  it("marks cancelled overviews", () => {
    expect(buildNoteTitle("修复登录", "cancelled")).toBe("任务概览（已取消）：修复登录");
  });

  it("caps the title at 200 chars", () => {
    expect(buildNoteTitle("x".repeat(300)).length).toBe(200);
  });
});
