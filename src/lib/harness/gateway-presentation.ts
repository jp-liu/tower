export type GatewayMessagePresentation = {
  title: string;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  blocks: Array<
    | { type: "text"; text: string }
    | { type: "section"; title: string; text: string }
    | { type: "fields"; fields: Array<{ label: string; value: string }> }
    | { type: "divider" }
    | { type: "context"; text: string }
  >;
};

function bounded(value: string | null | undefined, max = 2_000): string {
  const text = value?.trim() || "未提供";
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function statusLabel(value: string): string {
  return {
    TODO: "待处理",
    PENDING: "准备中",
    RUNNING: "执行中",
    IN_PROGRESS: "执行中",
    IN_REVIEW: "待审核",
    COMPLETED: "已完成",
    DONE: "已完成",
    FAILED: "执行失败",
    CANCELLED: "已取消",
  }[value.toUpperCase()] || value;
}

function priorityLabel(value: string): string {
  return {
    CRITICAL: "🔴 紧急",
    HIGH: "🟠 高",
    MEDIUM: "🟡 中",
    LOW: "🔵 低",
  }[value.toUpperCase()] || value;
}

function branchLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "none" || normalized === "未创建分支"
    ? "默认工作树"
    : value;
}

export function extractTaskGoal(description: string | null): string {
  if (!description?.trim()) return "未提供";
  const match = description.match(/(?:^|\n)##\s*目标\s*\n([\s\S]*?)(?=\n##\s|$)/u);
  return bounded(match?.[1] || description, 1_200);
}

export function discussionPresentation(projectName: string, response: string): GatewayMessagePresentation {
  return {
    title: "💬 小塔 · 项目讨论",
    tone: "info",
    blocks: [
      { type: "section", title: "讨论结论", text: bounded(response, 16_000) },
      { type: "divider" },
      { type: "context", text: `📁 ${projectName} · 项目 Workbench` },
    ],
  };
}

export function discussionQueuedPresentation(input: {
  projectName: string;
  inboundId: string;
}): GatewayMessagePresentation {
  return {
    title: "⏳ 小塔 · 讨论已进入工作台",
    tone: "info",
    blocks: [
      {
        type: "section",
        title: "正在分析",
        text: "项目 Workbench 已接收讨论，将结合仓库和当前项目上下文回复。本次讨论不会自动创建任务。",
      },
      { type: "divider" },
      { type: "context", text: `📁 ${input.projectName} · 请求 ID ${input.inboundId}` },
    ],
  };
}

export function queuedPresentation(input: {
  projectName: string;
  inboundId: string;
}): GatewayMessagePresentation {
  return {
    title: "⏳ 小塔 · 请求已进入工作台",
    tone: "warning",
    blocks: [
      {
        type: "section",
        title: "正在编排",
        text: "Workbench 已接收请求，正在确认项目上下文并准备任务。创建成功后会在此消息下继续反馈。",
      },
      {
        type: "fields",
        fields: [
          { label: "项目", value: input.projectName },
          { label: "当前阶段", value: "排队 / 解析请求" },
        ],
      },
      { type: "divider" },
      { type: "context", text: `请求 ID · ${input.inboundId}` },
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
    ? `已启动${input.executionStatus ? ` · ${statusLabel(input.executionStatus)}` : ""}`
    : "未自动启动";
  return {
    title: "🚀 小塔 · 任务已创建",
    tone: "success",
    blocks: [
      {
        type: "text",
        text: `**${bounded(input.title, 240)}**`,
      },
      {
        type: "fields",
        fields: [
          { label: "状态", value: statusLabel(input.status) },
          { label: "优先级", value: priorityLabel(input.priority) },
          { label: "项目", value: input.projectName },
          { label: "工作区", value: input.workspaceName },
          { label: "执行", value: autoStart },
          { label: "分支", value: branchLabel(input.branch) },
        ],
      },
      { type: "section", title: "任务目标", text: bounded(input.goal, 1_200) },
      { type: "divider" },
      { type: "context", text: `任务 ID · ${input.taskId}` },
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
    title: "✅ 小塔 · 任务已完成",
    tone: "success",
    blocks: [
      {
        type: "text",
        text: `**${bounded(input.title, 240)}**`,
      },
      { type: "section", title: "验收结果", text: bounded(input.summary, 8_000) },
      {
        type: "fields",
        fields: [
          {
            label: "代码提交",
            value: input.commitId === "none"
              ? "无提交"
              : `${input.commitId}${input.commitMessage ? ` · ${bounded(input.commitMessage, 160)}` : ""}`,
          },
          { label: "分支", value: branchLabel(input.branch) },
        ],
      },
      { type: "divider" },
      { type: "context", text: `任务 ID · ${input.taskId}` },
    ],
  };
}
