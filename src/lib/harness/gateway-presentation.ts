export type GatewayMessagePresentation = {
  title: string;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  blocks: Array<
    | { type: "text"; text: string }
    | { type: "divider" }
    | { type: "context"; text: string }
  >;
};

function bounded(value: string | null | undefined, max = 2_000): string {
  const text = value?.trim() || "未提供";
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function extractTaskGoal(description: string | null): string {
  if (!description?.trim()) return "未提供";
  const match = description.match(/(?:^|\n)##\s*目标\s*\n([\s\S]*?)(?=\n##\s|$)/u);
  return bounded(match?.[1] || description, 1_200);
}

export function discussionPresentation(projectName: string, response: string): GatewayMessagePresentation {
  return {
    title: "小塔 · 项目讨论",
    tone: "info",
    blocks: [
      { type: "text", text: bounded(response, 16_000) },
      { type: "divider" },
      { type: "context", text: `项目：${projectName}` },
    ],
  };
}

export function queuedPresentation(input: {
  projectName: string;
  inboundId: string;
}): GatewayMessagePresentation {
  return {
    title: "小塔 · 已排队",
    tone: "warning",
    blocks: [
      {
        type: "text",
        text: `请求已排队到 ${input.projectName} Workbench。任务尚未创建，创建成功后会另发确认。`,
      },
      { type: "divider" },
      { type: "context", text: `请求 ID：${input.inboundId}` },
    ],
  };
}

export function taskCreatedPresentation(input: {
  taskId: string;
  title: string;
  projectName: string;
  priority: string;
  status: string;
  workspaceName: string;
  branch: string;
  goal: string;
  autoStarted: boolean;
  executionStatus?: string | null;
}): GatewayMessagePresentation {
  const autoStart = input.autoStarted
    ? `是${input.executionStatus ? `（${input.executionStatus}）` : ""}`
    : "否";
  return {
    title: "小塔 · 任务已创建",
    tone: "success",
    blocks: [
      {
        type: "text",
        text: [
          `任务标题：${input.title}`,
          `项目：${input.projectName}`,
          `优先级：${input.priority}`,
          `状态：${input.status}`,
          `工作区：${input.workspaceName}`,
          `分支：${input.branch}`,
          `任务目标：${bounded(input.goal, 1_200)}`,
          `已自动启动：${autoStart}`,
        ].join("\n"),
      },
      { type: "divider" },
      { type: "context", text: `任务 ID：${input.taskId}` },
    ],
  };
}

export function finalResultPresentation(input: {
  taskId: string;
  title: string;
  summary: string;
  commitId: string;
  commitMessage: string;
  branch: string;
}): GatewayMessagePresentation {
  return {
    title: "小塔 · 任务已完成",
    tone: "success",
    blocks: [
      {
        type: "text",
        text: [
          `任务标题：${input.title}`,
          `结果：${bounded(input.summary, 8_000)}`,
          `提交：${input.commitId} ${input.commitMessage}`,
          `分支：${input.branch}`,
        ].join("\n"),
      },
      { type: "divider" },
      { type: "context", text: `任务 ID：${input.taskId}` },
    ],
  };
}
