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

/** `create_task` confirmation card. Mirrors the skill's "Task Creation
 *  Confirmation" template. `execution`/`error` reflect the auto-start outcome. */
export function renderTaskCreated(input: {
  title: string;
  projectName: string | null;
  projectAlias: string | null;
  projectId: string;
  priority: string;
  status: string;
  useWorktree: boolean;
  baseBranch: string | null;
  execution: { started: boolean; error?: string };
}): string {
  const lines = [
    `✅ Task created: **${input.title}**`,
    `- Project: ${input.projectName ?? input.projectId}${input.projectAlias ? ` (${input.projectAlias})` : ""}`,
    `- Priority: ${PRIORITY_EMOJI[input.priority] ?? ""} ${input.priority}`,
    `- Status: ${input.status}`,
    `- Worktree: ${input.useWorktree ? "yes" : "no"}`,
  ];
  if (input.useWorktree && input.baseBranch) lines.push(`- Base branch: ${input.baseBranch}`);
  if (input.execution.started) lines.push("⚡ Execution started");
  else if (input.execution.error) lines.push(`⚠️ Auto-start failed: ${input.execution.error}`);
  return lines.join("\n");
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
