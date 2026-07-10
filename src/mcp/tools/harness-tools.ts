import { z } from "zod";

const PORT = process.env.PORT ?? "3000";
const BRIDGE = `http://localhost:${PORT}/api/internal/harness`;
const CUID_RE = /^c[a-z0-9]{20,30}$/;

function validateMcpTaskId(taskId: string): string | null {
  if (!CUID_RE.test(taskId)) return "Invalid taskId format — expected CUID";
  return null;
}

/**
 * Compose ready-to-follow send instructions from the ACTIVE notify channel.
 * The tower-ask / tower-goal skills call list_notify_targets and just DO what
 * `instructions` says — no need to re-derive the gateway→platform-MCP mapping
 * from static skill docs. Tower only records; the agent does the real send.
 */
function composeSendInstructions(
  active: { gateway?: string; downstream?: string; label?: string },
  token: string,
  scope: "work" | "unattended",
  taskTitle: string | null,
): string {
  const gw = active.gateway ?? "";
  const via =
    gw === "feishu"
      ? `Send via the Feishu MCP (e.g. mcp__feishu__im_v1_message_create) directly to <destination>`
      : `Send via the ${gw} platform MCP; in the body state "via ${active.downstream ?? "downstream"} to <destination>"`;
  // Unattended: start the body with 【task title】 so the human can tell parallel goals apart and reply without crossing wires.
  const titlePrefix =
    scope === "unattended" && taskTitle
      ? `1. Start the body with 【${taskTitle}】 (lets the human tell which task this is when several run in parallel).\n`
      : "";
  const parkLine =
    scope === "work"
      ? `You're present (work channel): after the send succeeds, just record one notify_human; DO NOT park, DO NOT close the terminal — wait for the reply in the terminal to continue.`
      : `You're away (unattended channel): after the send succeeds, if a reply is needed to continue use ask_human (parks, waits for a bridge-injected reply); if it's just a heads-up use notify_human.`;
  return [
    `Channel class: ${scope === "work" ? "work (present · discuss in a group)" : "unattended (off-hours · reach the owner)"}`,
    `Active channel: ${active.label ?? gw} (gateway ${gw}${active.downstream ? ` → downstream ${active.downstream}` : ""})`,
    `Steps (order is fixed):`,
    titlePrefix + `${titlePrefix ? "2" : "1"}. ${via}. The body MUST contain the token ${token} verbatim (missing it → replies can't be attributed → task stuck forever).`,
    `   Only have a group/person name, no platform id → look the id up via the platform MCP first, then send.`,
    `${titlePrefix ? "3" : "2"}. ${parkLine}`,
    `If the send fails, don't call ask_human (else it parks but nobody got it) — retry, or leave the message in the /harness panel and stop.`,
  ].join("\n");
}

export const harnessTools = {
  list_notify_targets: {
    description:
      "Read the ACTIVE notify channel of a given SCOPE from Tower's DB (harness.targets) and return " +
      "READY-TO-FOLLOW send instructions for pushing a message to a human — used by the tower-ask / tower-goal " +
      "skills. Two scopes: 'work' (you're at the keyboard — send to a group/colleague for discussion, don't " +
      "park) and 'unattended' (off-hours — reach you personally, park while waiting). Tower only records; the " +
      "agent does the actual send via its own platform MCP. Pass the current taskId so the [[tower:task=...]] " +
      "token is filled in. Returns { scope, active, instructions }, or { noChannelConfigured: true } with " +
      "guidance if that scope has no active channel.",
    schema: z.object({
      scope: z
        .enum(["work", "unattended"])
        .optional()
        .describe(
          "Channel class: 'work' (in-office, send to a group) or 'unattended' (off-hours, reach you). " +
            "Pass it when the user explicitly named a destination (group → 'work'). If omitted, it defaults " +
            "from the task's goal-mode flag: goal mode on → 'unattended', off → 'work'.",
        ),
      taskId: z
        .string()
        .optional()
        .describe("Current task id (TOWER_TASK_ID) — embeds the [[tower:task=...]] token AND resolves the default scope from goal mode"),
    }),
    handler: async (args: { scope?: "work" | "unattended"; taskId?: string }) => {
      const { readConfigValue } = await import("@/lib/config-reader");
      // Look up the task once for both goal-mode (default scope) and title (unattended prefix).
      let goalMode = false;
      let taskTitle: string | null = null;
      if (args.taskId) {
        const { db } = await import("@/lib/db");
        const task = await db.task.findUnique({
          where: { id: args.taskId },
          select: { unattended: true, title: true },
        });
        goalMode = !!task?.unattended;
        taskTitle = task?.title ?? null;
      }
      // Explicit scope wins; else derive from goal mode; else fall back to 'unattended'.
      // This keeps scope right even if the agent forgot it's in goal mode.
      const scope: "work" | "unattended" = args.scope ?? (args.taskId ? (goalMode ? "unattended" : "work") : "unattended");
      const targets = await readConfigValue<
        Array<{ id?: string; label?: string; gateway?: string; downstream?: string; active?: boolean; scope?: string }>
      >("harness.targets", []);
      // Rows without an explicit scope are legacy unattended channels.
      const active = (Array.isArray(targets) ? targets : []).find(
        (x) => x?.active && x.gateway && (x.scope ?? "unattended") === scope,
      );
      if (!active) {
        const hint =
          scope === "work"
            ? "No active channel in the 'work' category. To send to a group, configure one under Settings → Notifications (work column) and mark it active — or just use your mounted platform MCP to send to the group the user named."
            : "No active channel in the 'unattended' category, so nothing can be pushed out. Don't pretend you sent it — tell the user to configure one under Settings → Notifications (unattended column) and mark it active.";
        return { scope, noChannelConfigured: true, instructions: hint };
      }
      const token = `[[tower:task=${args.taskId ?? "<taskId>"}]]`;
      return {
        scope,
        active: { gateway: active.gateway, downstream: active.downstream ?? null, label: active.label ?? null },
        instructions: composeSendInstructions(active, token, scope, taskTitle),
      };
    },
  },

  ask_human: {
    description:
      "Ask the human operator a question and PARK the task until they reply. " +
      "Call this ONLY when you are blocked on a decision you cannot make yourself, " +
      "or before a dangerous/irreversible action that needs sign-off. " +
      "This ENDS your turn — do NOT keep working after calling it. The task is suspended " +
      "(its terminal is closed to save resources) and later resumed with the human's answer " +
      "as your next message. This tool only RECORDS + parks — to actually reach the human, first push the " +
      "question via the tower-ask skill (call list_notify_targets for the active channel), then call this. " +
      "Otherwise it just waits visibly in the Tower /harness panel.",
    schema: z.object({
      taskId: z.string().describe("The current task id (TOWER_TASK_ID)"),
      question: z.string().min(1).max(4000).describe("The question / options for the human"),
    }),
    handler: async (args: { taskId: string; question: string }) => {
      const err = validateMcpTaskId(args.taskId);
      if (err) return { error: err, taskId: args.taskId };

      const res = await fetch(`${BRIDGE}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: args.taskId, question: args.question }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { error: data?.error ?? "ask failed", status: res.status };

      const base = {
        parked: true,
        requestId: data.requestId,
        message:
          "Question recorded and task parked. Your turn is over — stop now and wait. " +
          "You will be resumed with the human's answer as your next message.",
      };
      // 没有配置任何发送渠道 → 无法外推。告诉 agent 引导用户去设置页配置。
      if (data.noChannelConfigured) {
        return {
          ...base,
          noChannelConfigured: true,
          message:
            "Question recorded (visible in Tower's /harness panel) and task parked, but NO notify " +
            "channel is configured, so it cannot be pushed to any external channel. Before stopping, " +
            "tell the user: 请到「设置 → 通知 → 无人值守发送渠道」配置一个渠道，否则无法外发。",
        };
      }
      return base;
    },
  },

  notify_human: {
    description:
      "Send a NON-BLOCKING progress update / heads-up to the human operator, then KEEP WORKING. " +
      "Unlike ask_human this does not park the task or end your turn — use it for milestones, " +
      "status reports, or FYI notes that need no reply. This tool only RECORDS — to actually reach the human, " +
      "first push the note via the tower-ask skill (list_notify_targets for the active channel), then call this.",
    schema: z.object({
      taskId: z.string().describe("The current task id (TOWER_TASK_ID)"),
      message: z.string().min(1).max(4000).describe("The progress update for the human"),
    }),
    handler: async (args: { taskId: string; message: string }) => {
      const err = validateMcpTaskId(args.taskId);
      if (err) return { error: err, taskId: args.taskId };

      const res = await fetch(`${BRIDGE}/notify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: args.taskId, message: args.message }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { error: data?.error ?? "notify failed", status: res.status };

      return { ok: true, messageId: data.messageId };
    },
  },

  reply_to_ask: {
    description:
      "Deliver a human's reply back to a task that is PARKED waiting on ask_human, then RESUME it. " +
      "Use this (not send_task_terminal_input) when relaying an operator's answer from a channel " +
      "(Feishu/WeChat/etc.) so Tower records what was replied and shows the full round-trip in its log. " +
      "It marks the open question as answered, resumes the task's session, and injects the reply as the " +
      "task's next message. If the task has NO pending question, it does nothing and returns { no_pending: true } — " +
      "in that case treat the message as an ordinary request and handle it normally (create_task / search / etc.).",
    schema: z.object({
      taskId: z.string().describe("The task that is parked waiting for a reply (its TOWER_TASK_ID)"),
      text: z.string().min(1).max(8000).describe("The human's reply to inject into the task"),
    }),
    handler: async (args: { taskId: string; text: string }) => {
      const err = validateMcpTaskId(args.taskId);
      if (err) return { error: err, taskId: args.taskId };

      const res = await fetch(`${BRIDGE}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // allowRetry:false —— 只应答仍 OPEN 的问题；答后的新消息返回 no_pending 交 bridge 按普通消息处理。
        body: JSON.stringify({ taskId: args.taskId, text: args.text, allowRetry: false }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      // 409 = 该任务没有待回复的 ask —— 不是错误，告诉调用方按普通消息处理。
      if (res.status === 409) return { no_pending: true, taskId: args.taskId };
      if (!res.ok) return { error: data?.error ?? "reply failed", status: res.status };

      return { ok: true, taskId: args.taskId, mode: data.mode, injected: data.injected, deduped: data.deduped };
    },
  },
};
