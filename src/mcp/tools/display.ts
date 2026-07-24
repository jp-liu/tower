/**
 * Single source of truth for SERVER-RENDERED MCP result cards.
 *
 * Background: the tower skill (skills/tower/SKILL.md) documents "Display
 * Templates" for how tool results should look. That format used to live only in
 * skill prose, so every caller (assistant, OpenClaw, Feishu bot, CLI) re-derived
 * it from the skill — and at low effort a model often flattened a structured
 * result into an unscannable paragraph.
 *
 * Fix: for the confirmation/status tools whose result is a single self-contained
 * object (high flatten risk, cheap to render), the handler renders the card HERE
 * and returns it as a `display` field. Tool descriptions + the skill tell callers
 * to show `display` verbatim. It is a strong, ready-to-use suggestion (a remote
 * client can still ignore it), but copying ready text is the path of least
 * resistance — and the format is now identical across every caller.
 *
 * Maintenance rule (the whole point): each result format has exactly ONE home.
 *   - SERVER-rendered cards (below) → here. Change the format here, once.
 *   - MODEL-rendered tables (list_*, daily_*, search — arrays the client builds
 *     into a table from the skill template) → stay in the skill. We do NOT wrap
 *     their array shape in an object (that would break programmatic callers).
 * No format is documented in both places, so the two sides can't drift.
 */

const PRIORITY_EMOJI: Record<string, string> = {
  CRITICAL: "🔴",
  HIGH: "🟠",
  MEDIUM: "🟡",
  LOW: "⚪",
};

const PRIORITY_LABEL: Record<string, string> = {
  CRITICAL: "紧急",
  HIGH: "高",
  MEDIUM: "中等",
  LOW: "低",
};

const STATUS_LABEL: Record<string, string> = {
  TODO: "待开始",
  IN_PROGRESS: "进行中",
  IN_REVIEW: "待验收",
  DONE: "已完成",
  CANCELLED: "已取消",
};

/** `create_task` confirmation card. Mirrors the skill's "Task Creation
 *  Confirmation" template. `execution`/`error` reflect the auto-start outcome. */
export function renderTaskCreated(input: {
  taskId: string;
  title: string;
  description?: string | null;
  projectName: string | null;
  projectAlias: string | null;
  projectId: string;
  priority: string;
  status: string;
  useWorktree: boolean;
  baseBranch: string | null;
  attachedFiles?: string[];
  attachmentFailures?: { reference: string; error: string }[];
  projectFileReferences?: string[];
  execution: { started: boolean; error?: string };
}): string {
  const project = `${input.projectName ?? input.projectId}${input.projectAlias ? ` (${input.projectAlias})` : ""}`;
  const priority = `${PRIORITY_EMOJI[input.priority] ?? ""} ${PRIORITY_LABEL[input.priority] ?? input.priority}`.trim();
  const status = STATUS_LABEL[input.status] ?? input.status;
  const goal = extractMarkdownSection(input.description, "目标");
  const lines = [
    `✅ 已为您创建任务：**${input.title}**`,
    "",
    "📋 **任务详情：**",
    `- 项目：${project}`,
    `- 优先级：${priority}`,
    `- 状态：${status}`,
    `- 工作区：${input.useWorktree ? "已创建工作树用于开发" : "直接在项目目录执行"}`,
  ];
  if (input.useWorktree && input.baseBranch) lines.push(`- 基准分支：${input.baseBranch}`);
  lines.push(`- 任务 ID：${input.taskId}`);

  if (goal) {
    lines.push("", "🎯 **任务目标：**", goal);
  }

  lines.push("", "✅ **已准备就绪：**", "- 任务已创建并分配到正确的项目");
  lines.push(input.useWorktree ? "- 工作树已设置，可以直接开始开发" : "- 当前任务使用直接执行模式");
  lines.push("- 任务包含结构化需求描述与来源记录");

  if (input.attachedFiles?.length) {
    lines.push(`- 已关联参考附件：${input.attachedFiles.join(", ")}`);
  }
  if (input.projectFileReferences?.length) {
    lines.push(`- 已记录项目文件：${input.projectFileReferences.join(", ")}`);
  }
  if (input.attachmentFailures?.length) {
    lines.push(
      `- ⚠️ 有 ${input.attachmentFailures.length} 个附件未能关联：${input.attachmentFailures
        .map((f) => `${f.reference}（${f.error}）`)
        .join("；")}`,
    );
  }
  if (input.execution.started) lines.push("- ⚡ 已自动启动执行");
  else if (input.execution.error) lines.push(`- ⚠️ 自动启动失败：${input.execution.error}`);

  return lines.join("\n");
}

function extractMarkdownSection(markdown: string | null | undefined, heading: string): string | null {
  if (!markdown) return null;
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=^##\\s+|\\s*$)`, "m");
  const match = markdown.match(re);
  const value = match?.[1]
    ?.trim()
    .replace(/\n{3,}/g, "\n\n");
  return value || null;
}

/** `start_task_execution` confirmation. Mirrors the skill's "Start Execution
 *  Confirmation" template. */
export function renderStartExecution(input: {
  taskId: string;
  executionId?: string | null;
  worktreePath?: string | null;
}): string {
  return [
    "⚡ Execution started",
    `- Task: ${input.taskId}`,
    `- Execution ID: ${input.executionId ?? "—"}`,
    `- Worktree: ${input.worktreePath ?? "direct mode"}`,
  ].join("\n");
}

/** `get_task_execution_status` card. Mirrors the skill's "Execution Status"
 *  template. `startedAt`/`endedAt` are echoed as-is (no tz reformatting). */
export function renderExecutionStatus(input: {
  taskId: string;
  executionId: string;
  executionStatus: string;
  terminalStatus: string;
  startedAt: Date | string | null;
  endedAt: Date | string | null;
  outputSnippet: string | null;
}): string {
  const started = input.startedAt ? String(input.startedAt) : "—";
  const ended = input.endedAt ? ` · Ended: ${String(input.endedAt)}` : "";
  return [
    `⚙️ **${input.taskId}**`,
    `- Execution: ${input.executionStatus} · Terminal: ${input.terminalStatus}`,
    `- Started: ${started}${ended}`,
    `- ID: ${input.executionId}`,
    "- Output (last lines):",
    "```",
    input.outputSnippet ?? "No output",
    "```",
  ].join("\n");
}

/** `get_task_terminal_output` card. Mirrors the skill's "Terminal Output"
 *  template. */
export function renderTerminalOutput(input: {
  taskId: string;
  lines: string[];
  total: number;
}): string {
  return [
    `📺 Terminal — ${input.taskId} (${input.total} total lines, showing last ${input.lines.length})`,
    "```",
    input.lines.join("\n"),
    "```",
  ].join("\n");
}
