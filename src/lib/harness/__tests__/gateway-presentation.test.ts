import { describe, expect, it } from "vitest";
import {
  finalResultPresentation,
  queuedPresentation,
  taskCreatedPresentation,
} from "../gateway-presentation";
import { toFeishuInteractiveCard } from "../openclaw-send";

describe("gateway presentation cards", () => {
  it("renders a compact task-created card with a two-column fact grid", () => {
    const presentation = taskCreatedPresentation({
      taskId: "task-1",
      title: "读取当前 git HEAD 短 commit id",
      projectName: "tower",
      priority: "LOW",
      status: "IN_PROGRESS",
      workspaceName: "Tower",
      branch: "未创建分支",
      goal: "只读检查，不修改文件。",
      autoStarted: true,
      executionStatus: "RUNNING",
    });
    const card = toFeishuInteractiveCard(presentation, "fallback") as {
      header: { title: { content: string } };
      elements: Array<{ tag?: string; fields?: unknown[] }>;
    };

    expect(card.header.title.content).toBe("🚀 小塔 · 任务已创建");
    expect(card.elements.find((element) => element.fields)?.fields).toHaveLength(6);
    expect(JSON.stringify(card)).toContain("执行中");
    expect(JSON.stringify(card)).toContain("🔵 低");
    expect(JSON.stringify(card)).toContain("默认工作树");
    expect(JSON.stringify(card)).not.toContain("IN_PROGRESS");
  });

  it("separates reviewed result from commit metadata", () => {
    const presentation = finalResultPresentation({
      taskId: "task-2",
      title: "临时验收",
      summary: "只读验收通过，未修改文件。",
      commitId: "none",
      commitMessage: "No commit recorded",
      branch: "none",
    });
    const card = toFeishuInteractiveCard(presentation, "fallback");
    const json = JSON.stringify(card);

    expect(json).toContain("验收结果");
    expect(json).toContain("无提交");
    expect(json).toContain("默认工作树");
    expect(json).not.toContain("none No commit recorded");
  });

  it("makes queued state explicit without claiming task creation", () => {
    const presentation = queuedPresentation({
      projectName: "tower",
      inboundId: "inbound-1",
    });
    const json = JSON.stringify(toFeishuInteractiveCard(presentation, "fallback"));

    expect(json).toContain("请求已进入工作台");
    expect(json).toContain("排队 / 解析请求");
    expect(json).not.toContain("任务已创建");
  });
});
