import { z } from "zod";
import { extractTowerTaskId, findHarnessDeliveryByPlatformMessageId } from "@/lib/harness/delivery-map";
import { readHarnessGatewayRuntimeConfig } from "@/lib/harness/gateway-config";
import { signedInternalFetch as fetch } from "@/lib/internal-api-signing";

export { parseGatewaySendOutput } from "@/lib/harness/gateway-output";

const PORT = process.env.PORT ?? "3000";
const BRIDGE = `http://localhost:${PORT}/api/internal/harness`;
const GATEWAY_BRIDGE = `${BRIDGE}/gateway`;
const GATEWAY_QUERY_BRIDGE = `${BRIDGE}/gateway-query`;
const GATEWAY_TASK_BRIDGE = `${BRIDGE}/gateway-task`;
const GATEWAY_DIAGNOSTICS_BRIDGE = `${BRIDGE}/gateway-diagnostics`;
const GATEWAY_RUNTIME_HEALTH_BRIDGE = `${BRIDGE}/gateway-runtime-health`;
const HARNESS_OUTBOUND_BRIDGE = `${BRIDGE}/outbound`;
const REMOTE_PROJECT_BRIDGE = `${BRIDGE}/remote-project`;
const WORKBENCH_BATCH_BRIDGE = `http://localhost:${PORT}/api/internal/workbench/batch`;
const CUID_RE = /^c[a-z0-9]{20,30}$/;

function validateMcpTaskId(taskId: string): string | null {
  if (!CUID_RE.test(taskId)) return "Invalid taskId format — expected CUID";
  return null;
}

function resolveTaskForCurrentTerminal(taskId?: string): { taskId: string } | { error: string } {
  const currentTaskId = process.env.TOWER_TASK_ID?.trim();
  const selectedTaskId = taskId?.trim() || currentTaskId;
  if (!selectedTaskId) return { error: "taskId required" };
  const formatErr = validateMcpTaskId(selectedTaskId);
  if (formatErr) return { error: formatErr };
  if (currentTaskId && currentTaskId !== selectedTaskId) {
    return {
      error: `Task boundary mismatch — this terminal is bound to ${currentTaskId}, refusing to operate on ${selectedTaskId}`,
    };
  }
  return { taskId: selectedTaskId };
}

/**
 * Compose ready-to-follow send instructions from the ACTIVE notify channel.
 * The tower-ask / tower-goal skills call list_notify_targets and just DO what
 * `instructions` says — no need to re-derive the gateway→platform-MCP mapping
 * from static skill docs. Tower only records; the agent does the real send.
 */
type NotifyTargetConfig = {
  id?: string;
  label?: string;
  gateway?: string;
  downstream?: string;
  dest?: string;
  profile?: string;
  active?: boolean;
  scope?: string;
};

type MessagePresentation = {
  title: string;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  blocks: Array<
    | { type: "text"; text: string }
    | { type: "divider" }
    | { type: "context"; text: string }
  >;
};

function buildTowerOutboundPresentation(args: {
  agentName: string;
  message: string;
  token: string;
  scope: "work" | "unattended";
  taskTitle: string | null;
}): MessagePresentation {
  const body = buildTowerOutboundText({
    message: args.message,
    token: null,
    taskTitle: args.taskTitle,
  });
  return {
    title: args.agentName.trim() || "Tower",
    tone: args.scope === "unattended" ? "warning" : "info",
    blocks: [
      { type: "text", text: body },
      { type: "divider" },
      { type: "context", text: `Task ID: ${args.token}` },
    ],
  };
}

function buildTowerOutboundText(args: {
  message: string;
  token: string | null;
  taskTitle: string | null;
}): string {
  return [
    args.taskTitle?.trim() || null,
    args.message.trim(),
    args.token ? `Task ID: ${args.token}` : null,
  ].filter(Boolean).join("\n\n");
}

function composeSendInstructions(
  active: NotifyTargetConfig,
  token: string,
  scope: "work" | "unattended",
  taskTitle: string | null,
): string {
  const gw = active.gateway ?? "";
  const destination =
    active.dest?.trim() ||
    (gw === "hermes" && scope === "unattended" && active.downstream?.trim()
      ? `${active.downstream.trim()} home channel`
      : "<missing destination>");
  if (gw === "hermes") {
    const workDestination =
      scope === "work"
        ? "The caller must pass `to` to push_to_human unless this target has an exact destination. `to` can be a group/person name, an alias from harness.destinations, or a platform id."
        : "";
    return [
      `Channel class: ${scope === "work" ? "work (present · discuss in a group)" : "unattended (off-hours · reach the owner)"}`,
      `Active channel: ${active.label ?? gw} (gateway ${gw}${active.downstream ? ` -> downstream ${active.downstream}` : ""}, destination ${destination})`,
      `Preferred path: call push_to_human({ taskId, message, scope: "${scope}",${scope === "work" ? " to,": ""} expectReply: ${scope === "unattended" ? "true" : "false"} }).`,
      workDestination,
      `push_to_human sends through Hermes first, then records with ${scope === "unattended" ? "ask_human (park)" : "notify_human (no park)"} only after the send succeeds.`,
      `The body will include the token ${token} so replies can be attributed.`,
    ].filter(Boolean).join("\n");
  }
  if (gw === "openclaw") {
    return [
      `Channel class: ${scope === "work" ? "work (present · discuss in a group)" : "unattended (off-hours · reach the owner)"}`,
      `Active channel: ${active.label ?? gw} (gateway ${gw}${active.downstream ? ` -> downstream ${active.downstream}` : ""}, destination ${destination})`,
      `Preferred path: call push_to_human({ taskId, message, scope: "${scope}",${scope === "work" ? " to,": ""} expectReply: ${scope === "unattended" ? "true" : "false"} }).`,
      scope === "work"
        ? "The `to` value comes from the user's instruction (group/person name, alias, or platform id). OpenClaw may resolve names for providers with a directory; otherwise use an alias/id."
        : "For unattended, omit `to` only when the target has a configured owner destination.",
      `push_to_human sends through OpenClaw first, then records with ${scope === "unattended" ? "ask_human (park)" : "notify_human (no park)"} only after the send succeeds.`,
      `The body will include the token ${token} so replies can be attributed.`,
    ].join("\n");
  }
  const via = `Send via the ${gw} gateway; in the body state "via ${active.downstream ?? "downstream"} to ${destination}"`;
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
    `Active channel: ${active.label ?? gw} (gateway ${gw}${active.downstream ? ` → downstream ${active.downstream}` : ""}, destination ${destination})`,
    `Steps (order is fixed):`,
    titlePrefix + `${titlePrefix ? "2" : "1"}. ${via}. The body MUST contain the token ${token} verbatim (missing it → replies can't be attributed → task stuck forever).`,
    `   Only have a group/person name, no platform id → look the id up via the platform MCP first, then send.`,
    `${titlePrefix ? "3" : "2"}. ${parkLine}`,
    `If the send fails, don't call ask_human (else it parks but nobody got it) — retry, or leave the message in the /harness panel and stop.`,
  ].join("\n");
}

async function resolveActiveTarget(taskId: string, explicitScope?: "work" | "unattended") {
  const { db } = await import("@/lib/db");
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { unattended: true, title: true },
  });
  if (!task) return { error: "task not found" as const };
  const scope: "work" | "unattended" = explicitScope ?? (task.unattended ? "unattended" : "work");
  const { readConfigValue } = await import("@/lib/config-reader");
  const targets = await readConfigValue<NotifyTargetConfig[]>("harness.targets", []);
  const active = (Array.isArray(targets) ? targets : []).find(
    (x) => x?.active && x.gateway && (x.scope ?? "unattended") === scope,
  );
  return { task, scope, active };
}

type RelayChannelReplyArgs = {
  text: string;
  taskId?: string;
  platform?: string;
  chatId?: string;
  platformMessageId?: string;
  quotedText?: string;
};

export async function relayChannelReply(args: RelayChannelReplyArgs) {
  const delivery = args.platformMessageId
    ? await findHarnessDeliveryByPlatformMessageId(args.platformMessageId)
    : null;
  const taskId = delivery?.taskId || args.taskId || extractTowerTaskId(args.quotedText) || extractTowerTaskId(args.text);
  if (!taskId) return { error: "No tower task token found", no_task_token: true };
  const err = validateMcpTaskId(taskId);
  if (err) return { error: err, taskId };

  const chatScope = delivery ? null : await resolveScopeFromInboundChat(args.platform, args.chatId);
  const shouldAnswerAsk =
    delivery?.expectReply ??
    (chatScope === "work" ? false : !!(await getOpenAskForRelay(taskId)));
  const replyText = await buildExternalReplyText(taskId, args);
  if (shouldAnswerAsk) {
    const res = await fetch(`${BRIDGE}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId, text: replyText, allowRetry: false }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status !== 409) {
      if (!res.ok) return { error: data?.error ?? "reply failed", status: res.status, taskId };
      return { ok: true, mode: "ask_reply", taskId, injected: data.injected, delivery, chatScope };
    }
    if (delivery?.expectReply) return { no_pending: true, taskId, delivery };
  }

  return {
    ok: true,
    mode: "task_context",
    taskId,
    delivery,
    chatScope,
    resumed: false,
    continuationRequired: true,
    instructions:
      "Task binding resolved without resuming its terminal. Use read-only Tower tools for a query, delegate external work without changing Tower, or call continue_bound_task for an explicit development continuation.",
  };
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
      // Invariant: no usable reply token without a real taskId. Refuse to emit a send
      // instruction at all (the placeholder [[tower:task=<taskId>]] can't be attributed
      // and reply_to_ask rejects it → task would be stuck forever).
      const bound = resolveTaskForCurrentTerminal(args.taskId);
      if ("error" in bound) {
        return {
          error: bound.error,
          instructions:
            "Do NOT send. Call list_notify_targets again with the current TOWER_TASK_ID so the reply " +
            "token can be attributed.",
        };
      }
      const { taskId } = bound;
      const resolved = await resolveActiveTarget(taskId, args.scope);
      if ("error" in resolved) {
        return {
          error: resolved.error,
          instructions: "Do NOT send. The given taskId does not resolve to a task.",
        };
      }
      const { task, scope, active } = resolved;
      if (!active) {
        const hint =
          scope === "work"
            ? "No active channel in the 'work' category. To send to a group, configure one under Settings → Notifications (work column) and mark it active — or just use your mounted platform MCP to send to the group the user named."
            : "No active channel in the 'unattended' category, so nothing can be pushed out. Don't pretend you sent it — tell the user to configure one under Settings → Notifications (unattended column) and mark it active.";
        return { scope, noChannelConfigured: true, instructions: hint };
      }
      const token = `[[tower:task=${taskId}]]`;
      return {
        scope,
        active: {
          gateway: active.gateway,
          downstream: active.downstream ?? null,
          dest: active.dest ?? null,
          profile: active.profile ?? null,
          label: active.label ?? null,
        },
        instructions: composeSendInstructions(active, token, scope, task.title ?? null),
      };
    },
  },

  push_to_human: {
    description:
      "Durably enqueue a task-to-human message before any external send. Tower's outbox worker claims and sends it, " +
      "then atomically records the platform receipt, activates the ask, and parks the task when expectReply=true. " +
      "Failed sends remain retryable; an in-flight crash becomes SENT_UNVERIFIED instead of being blindly resent.",
    schema: z.object({
      taskId: z.string().optional().describe("The current task id (TOWER_TASK_ID); defaults to the terminal's TOWER_TASK_ID when present"),
      message: z.string().min(1).max(4000).describe("Message body to send to the human/group"),
      scope: z.enum(["work", "unattended"]).optional().describe("Channel scope. Omit to derive from goal mode."),
      to: z.string().optional().describe("Destination for work messages: group/person name, Tower alias, or platform id. Optional for unattended home routes."),
      expectReply: z.boolean().optional().describe("If true, record with ask_human and park. Defaults true for unattended, false for work."),
      dedupKey: z.string().min(1).max(256).optional().describe("Stable caller key for an intentional logical send. Reusing it returns the same durable outbound."),
    }),
    handler: async (args: {
      taskId?: string;
      message: string;
      scope?: "work" | "unattended";
      to?: string;
      expectReply?: boolean;
      dedupKey?: string;
    }) => {
      const bound = resolveTaskForCurrentTerminal(args.taskId);
      if ("error" in bound) return { error: bound.error, taskId: args.taskId };
      const { taskId } = bound;

      const resolved = await resolveActiveTarget(taskId, args.scope);
      if ("error" in resolved) return { error: resolved.error, taskId };
      const { task, scope, active } = resolved;
      if (!active) return { error: `No active ${scope} channel configured`, noChannelConfigured: true };
      if (active.gateway !== "hermes" && active.gateway !== "openclaw") {
        return { error: `push_to_human supports Hermes/OpenClaw channels only; active gateway is ${active.gateway}` };
      }
      if (scope === "work" && !active.dest?.trim() && !args.to?.trim()) {
        return {
          error: `No destination provided for active ${scope} ${active.gateway} channel`,
          noChannelConfigured: true,
          hint: "Pass `to` from the user's instruction, e.g. a group/person name, Tower alias, or platform id.",
        };
      }

      const token = `[[tower:task=${taskId}]]`;
      const body = buildTowerOutboundText({
        message: args.message,
        token,
        taskTitle: task.title ?? null,
      });
      const gatewayRuntime = await readHarnessGatewayRuntimeConfig(active.gateway);
      const presentation = buildTowerOutboundPresentation({
        agentName: gatewayRuntime.displayName || "Tower",
        message: args.message,
        token,
        scope,
        taskTitle: task.title ?? null,
      });
      const expectReply = args.expectReply ?? scope === "unattended";
      const res = await fetch(HARNESS_OUTBOUND_BRIDGE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId,
          gateway: active.gateway,
          downstream: active.downstream ?? null,
          dest: active.dest ?? null,
          requestedTo: args.to ?? null,
          profile: active.profile ?? null,
          scope,
          expectReply,
          message: body,
          presentation,
          dedupKey: args.dedupKey ?? null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { error: data?.error ?? "durable outbound enqueue failed", status: res.status };
      return { ok: true, scope, expectReply, ...data };
    },
  },

  relay_channel_reply: {
    description:
      "Compatibility bridge for a human reply from Feishu/WeChat/Hermes. It may answer a matching open " +
      "ask_human, but ordinary task replies are context-only and NEVER resume or inject into a terminal. " +
      "New gateway callers should use resolve_gateway_task_context, reply_to_ask, or continue_bound_task explicitly.",
    schema: z.object({
      text: z.string().min(1).max(8000).describe("The human's reply text"),
      taskId: z.string().optional().describe("Task id if already parsed from the token"),
      platform: z.string().optional().describe("Inbound platform, e.g. feishu or weixin"),
      chatId: z.string().optional().describe("Inbound chat id, e.g. Feishu oc_xxx. Helps disambiguate work group replies from unattended DM replies."),
      platformMessageId: z.string().optional().describe("The Feishu/WeChat message id being replied to, if available"),
      quotedText: z.string().optional().describe("Quoted/replied-to message text, if available"),
    }),
    handler: relayChannelReply,
  },

  route_gateway_message: {
    description:
      "Persist and route one Tower-related inbound gateway message. Ordinary Q&A and external operator work " +
      "stay in the gateway and must not call this tool. Classify Tower traffic as TOWER (Tower query/simple " +
      "command), PROJECT_DISCUSSION, or PROJECT_WORK. Tower applies reply/task binding, thread/session binding, " +
      "explicit project, identify_project, recent-user project, and channel default in that strict order. It " +
      "returns candidates instead of guessing. Task replies return context without terminal side effects; project " +
      "work is durably queued for the project Workbench; discussions get an independent project-bound session. " +
      "Set startNewWork only for an explicit create-new-task/start-new-work request, so it " +
      "can override an old task-card reply; ordinary task follow-ups keep their reply binding. Use sessionAction=CLOSE " +
      "for an explicit Tower discussion close, and NEW when explicitly switching projects or starting a fresh discussion. " +
      "Duplicate callbacks return in_progress/already_processed with noOp=true; never repeat the original action.",
    schema: z.object({
      gateway: z.enum(["hermes", "openclaw"]),
      platform: z.string().min(1).max(64),
      chatId: z.string().min(1).max(512),
      platformMessageId: z.string().min(1).max(512).describe("Unique id of this inbound platform message"),
      senderId: z.string().max(512).optional(),
      threadId: z.string().max(512).optional(),
      rootMessageId: z.string().max(512).optional(),
      replyToMessageId: z.string().max(512).optional().describe("Platform message id this inbound message replies to"),
      quotedText: z.string().max(16000).optional(),
      taskId: z.string().optional(),
      project: z.string().max(512).optional().describe("Explicit project id, name, alias, or identify_project query from the user"),
      intent: z.enum(["TOWER", "PROJECT_DISCUSSION", "PROJECT_WORK"]),
      content: z.string().min(1).max(16000),
      sessionAction: z.enum(["CONTINUE", "NEW", "CLOSE"]).optional(),
      startNewWork: z.boolean().optional().describe("True only when the user explicitly asks to create a new task or start new work, including while replying to an old task message"),
    }),
    handler: async (args: {
      gateway: "hermes" | "openclaw";
      platform: string;
      chatId: string;
      platformMessageId: string;
      senderId?: string;
      threadId?: string;
      rootMessageId?: string;
      replyToMessageId?: string;
      quotedText?: string;
      taskId?: string;
      project?: string;
      intent: "TOWER" | "PROJECT_DISCUSSION" | "PROJECT_WORK";
      content: string;
      sessionAction?: "CONTINUE" | "NEW" | "CLOSE";
      startNewWork?: boolean;
    }) => {
      const res = await fetch(GATEWAY_BRIDGE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const routed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { error: routed.error ?? "gateway routing failed", status: res.status };
      return routed;
    },
  },

  resolve_gateway_task_context: {
    description:
      "Resolve which Tower task an external reply refers to without persisting an inbound, changing task state, " +
      "creating an execution, or starting/resuming a terminal. The result includes task status, latest execution " +
      "summary, open-ask state, project, producer, and Workbench context. Resolving a task never authorizes continuation.",
    schema: z.object({
      gateway: z.enum(["hermes", "openclaw"]),
      platform: z.string().min(1).max(64),
      chatId: z.string().min(1).max(512),
      replyToMessageId: z.string().max(512).optional(),
      quotedText: z.string().max(16000).optional(),
      taskId: z.string().optional(),
    }).refine((value) => value.replyToMessageId || value.quotedText || value.taskId, {
      message: "replyToMessageId, quotedText, or taskId is required",
    }),
    handler: async (args: {
      gateway: "hermes" | "openclaw";
      platform: string;
      chatId: string;
      replyToMessageId?: string;
      quotedText?: string;
      taskId?: string;
    }) => {
      const res = await fetch(GATEWAY_TASK_BRIDGE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok
        ? data
        : { error: (data as { error?: unknown }).error ?? "gateway task context failed", status: res.status };
    },
  },

  continue_bound_task: {
    description:
      "OWNER-only explicit continuation of the task bound to one external platform message. Use only when the " +
      "user clearly asks to continue, fix, or rerun Tower development work. This action persists the request, " +
      "deduplicates by platformMessageId, resumes or starts exactly the bound task, and injects the instruction once. " +
      "It refuses tasks with an open ask_human question; use reply_to_ask for those.",
    schema: z.object({
      gateway: z.enum(["hermes", "openclaw"]),
      platform: z.string().min(1).max(64),
      chatId: z.string().min(1).max(512),
      platformMessageId: z.string().min(1).max(512).describe("Unique id of the inbound message requesting continuation"),
      senderId: z.string().max(512).optional(),
      replyToMessageId: z.string().max(512).optional(),
      quotedText: z.string().max(16000).optional(),
      taskId: z.string().optional(),
      content: z.string().min(1).max(10000),
    }).refine((value) => value.replyToMessageId || value.quotedText || value.taskId, {
      message: "replyToMessageId, quotedText, or taskId is required",
    }),
    handler: async (args: {
      gateway: "hermes" | "openclaw";
      platform: string;
      chatId: string;
      platformMessageId: string;
      senderId?: string;
      replyToMessageId?: string;
      quotedText?: string;
      taskId?: string;
      content: string;
    }) => {
      const res = await fetch(GATEWAY_TASK_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok
        ? data
        : { error: (data as { error?: unknown }).error ?? "gateway task continuation failed", status: res.status };
    },
  },

  route_gateway_query: {
    description:
      "Read-only gateway entry for a non-owner in a trusted channel. It durably binds the inbound message to " +
      "one allowed project discussion and can never relay a task reply, create a task, start a terminal, or enqueue " +
      "Workbench work. Use the returned candidates instead of guessing. After routing, call " +
      "read_gateway_project_context and then complete_gateway_discussion.",
    schema: z.object({
      gateway: z.enum(["hermes", "openclaw"]),
      platform: z.string().min(1).max(64),
      chatId: z.string().min(1).max(512),
      platformMessageId: z.string().min(1).max(512),
      senderId: z.string().max(512).optional(),
      threadId: z.string().max(512).optional(),
      rootMessageId: z.string().max(512).optional(),
      replyToMessageId: z.string().max(512).optional(),
      quotedText: z.string().max(16000).optional(),
      project: z.string().max(512).optional(),
      content: z.string().min(1).max(16000),
      sessionAction: z.enum(["CONTINUE", "NEW", "CLOSE"]).optional(),
    }),
    handler: async (args: {
      gateway: "hermes" | "openclaw";
      platform: string;
      chatId: string;
      platformMessageId: string;
      senderId?: string;
      threadId?: string;
      rootMessageId?: string;
      replyToMessageId?: string;
      quotedText?: string;
      project?: string;
      content: string;
      sessionAction?: "CONTINUE" | "NEW" | "CLOSE";
    }) => {
      const res = await fetch(GATEWAY_QUERY_BRIDGE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { error: (data as { error?: unknown }).error ?? "gateway project query failed", status: res.status };
    },
  },

  read_gateway_project_context: {
    description:
      "Read project knowledge and recent task status only through the project binding created by " +
      "route_gateway_query. The caller cannot supply a project id, workspace id, or local path, so this tool " +
      "cannot escape the trusted channel's allowed project scope.",
    schema: z.object({
      inboundId: z.string().min(1).max(128),
      question: z.string().min(1).max(8000),
    }),
    handler: async (args: { inboundId: string; question: string }) => {
      const res = await fetch(GATEWAY_QUERY_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { error: (data as { error?: unknown }).error ?? "gateway project context failed", status: res.status };
    },
  },

  diagnose_gateway_request: {
    description:
      "OWNER diagnostics for one external request. Correlates the platform message, Tower inbound route, " +
      "durable Workbench event/batch/runtime, child task/execution, and every outbound delivery into ordered " +
      "stages. Use this instead of manually querying tables or guessing from one terminal log.",
    schema: z.object({
      inboundId: z.string().min(1).max(128).optional(),
      platformMessageId: z.string().min(1).max(512).optional(),
    }).refine((value) => value.inboundId || value.platformMessageId, {
      message: "inboundId or platformMessageId is required",
    }),
    handler: async (args: { inboundId?: string; platformMessageId?: string }) => {
      const res = await fetch(GATEWAY_DIAGNOSTICS_BRIDGE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { error: (data as { error?: unknown }).error ?? "gateway diagnostics failed", status: res.status };
    },
  },

  recover_gateway_request: {
    description:
      "OWNER-only safe recovery for one diagnosed gateway inbound id. Retries only failed deliveries that have " +
      "no platform message id and reopens only that request's durable Workbench path. It never auto-resends a " +
      "SENT_UNVERIFIED card because the platform may already contain it.",
    schema: z.object({
      inboundId: z.string().min(1).max(128),
    }),
    handler: async (args: { inboundId: string }) => {
      const res = await fetch(GATEWAY_DIAGNOSTICS_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { error: (data as { error?: unknown }).error ?? "gateway recovery failed", status: res.status };
    },
  },

  get_gateway_runtime_health: {
    description:
      "OWNER runtime diagnostics for OpenClaw or Hermes. Reads bounded service health and recent warning/error " +
      "logs, redacts credentials and home paths, and can filter by a Tower trace id or platform message id. " +
      "Use together with diagnose_gateway_request to distinguish gateway failures from Tower/Workbench failures.",
    schema: z.object({
      gateway: z.enum(["openclaw", "hermes"]),
      trace: z.string().min(1).max(512).optional(),
      includeLogs: z.boolean().optional().default(true),
    }),
    handler: async (args: { gateway: "openclaw" | "hermes"; trace?: string; includeLogs?: boolean }) => {
      const res = await fetch(GATEWAY_RUNTIME_HEALTH_BRIDGE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { error: (data as { error?: unknown }).error ?? "gateway runtime health failed", status: res.status };
    },
  },

  provision_remote_project: {
    description:
      "OWNER-only remote Git project orchestrator. PROVISION requires gitUrl, workspaceId, and an absolute " +
      "localRoot; when any is missing it returns needsInput instead of guessing. It clones with Git directly, " +
      "registers the Tower project, creates its resident Workbench, and never installs dependencies or runs " +
      "repository scripts. REVIEW_ONLY is the default. SET_MODE explicitly changes REVIEW_ONLY/FULL_WORK. " +
      "STATUS reports the durable registration.",
    schema: z.object({
      action: z.enum(["PROVISION", "SET_MODE", "STATUS"]),
      gitUrl: z.string().max(2000).optional(),
      workspaceId: z.string().max(128).optional(),
      localRoot: z.string().max(2000).optional(),
      name: z.string().max(200).optional(),
      directoryName: z.string().max(200).optional(),
      projectId: z.string().max(128).optional(),
      accessMode: z.enum(["REVIEW_ONLY", "FULL_WORK"]).optional(),
    }),
    handler: async (args: {
      action: "PROVISION" | "SET_MODE" | "STATUS";
      gitUrl?: string;
      workspaceId?: string;
      localRoot?: string;
      name?: string;
      directoryName?: string;
      projectId?: string;
      accessMode?: "REVIEW_ONLY" | "FULL_WORK";
    }) => {
      if ((args.action === "SET_MODE" || args.action === "STATUS") && !args.projectId) {
        return { error: "projectId is required for SET_MODE and STATUS" };
      }
      if (args.action === "SET_MODE" && !args.accessMode) {
        return { error: "accessMode is required for SET_MODE" };
      }
      const res = await fetch(REMOTE_PROJECT_BRIDGE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { error: (data as { error?: unknown }).error ?? "remote project provisioning failed", status: res.status };
    },
  },

  complete_gateway_discussion: {
    description:
      "Send the project-aware answer for a route_gateway_message PROJECT_DISCUSSION result back to the original " +
      "platform thread. Delivery is persisted and idempotent. Call this after using the returned project context; " +
      "do not restate the response in the gateway's final output after this tool sends it.",
    schema: z.object({
      inboundId: z.string().min(1).max(128),
      response: z.string().min(1).max(16000),
    }),
    handler: async (args: { inboundId: string; response: string }) => {
      const res = await fetch(GATEWAY_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "discussion", ...args }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { error: (data as { error?: unknown }).error ?? "discussion delivery failed", status: res.status };
    },
  },

  ack_workbench_batch: {
    description:
      "Workbench-only: acknowledge that the resident Workbench actually received and read a durable batch. " +
      "Call this immediately when a prompt contains '[Tower durable batch: wb-...]'. PTY delivery alone does " +
      "not consume the inbox rows; only resolve_workbench_batch releases responsibility. The lease token fences " +
      "stale Workbench executions. Repeated calls renew the processing lease and are idempotent.",
    schema: z.object({
      batchId: z.string().trim().min(1).max(128),
      leaseToken: z.string().trim().min(1).max(128),
    }),
    handler: async (args: { batchId: string; leaseToken: string }) => {
      const parentTaskId = process.env.TOWER_TASK_ID?.trim();
      if (!parentTaskId) return { error: "ack_workbench_batch must run inside the bound Workbench terminal" };
      const res = await fetch(WORKBENCH_BATCH_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ack", parentTaskId, ...args }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : {
        error: (data as { error?: unknown }).error ?? "Workbench batch acknowledgement failed",
        status: res.status,
      };
    },
  },

  heartbeat_workbench_batch: {
    description:
      "Workbench-only: renew an ACKED durable batch responsibility lease while long-running review/delegation " +
      "continues. Use the exact leaseToken from the batch prompt. A stale token is rejected.",
    schema: z.object({
      batchId: z.string().trim().min(1).max(128),
      leaseToken: z.string().trim().min(1).max(128),
    }),
    handler: async (args: { batchId: string; leaseToken: string }) => {
      const parentTaskId = process.env.TOWER_TASK_ID?.trim();
      if (!parentTaskId) return { error: "heartbeat_workbench_batch must run inside the bound Workbench terminal" };
      const res = await fetch(WORKBENCH_BATCH_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "heartbeat", parentTaskId, ...args }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : {
        error: (data as { error?: unknown }).error ?? "Workbench batch heartbeat failed",
        status: res.status,
      };
    },
  },

  resolve_workbench_batch: {
    description:
      "Workbench-only: mark an acknowledged durable batch fully handled. Call only after every item in the " +
      "batch has been completed or durably delegated. The batch must be ACKED first; repeated calls are idempotent.",
    schema: z.object({
      batchId: z.string().trim().min(1).max(128),
      leaseToken: z.string().trim().min(1).max(128),
    }),
    handler: async (args: { batchId: string; leaseToken: string }) => {
      const parentTaskId = process.env.TOWER_TASK_ID?.trim();
      if (!parentTaskId) return { error: "resolve_workbench_batch must run inside the bound Workbench terminal" };
      const res = await fetch(WORKBENCH_BATCH_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resolve", parentTaskId, ...args }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : {
        error: (data as { error?: unknown }).error ?? "Workbench batch resolution failed",
        status: res.status,
      };
    },
  },

  confirm_gateway_task_created: {
    description:
      "Workbench-only: confirm a PROJECT_WORK request after create_task actually returned the child task id. " +
      "Tower validates the task belongs to the bound project and sends one idempotent confirmation containing " +
      "the title and Tower locator. Never call before create_task succeeds.",
    schema: z.object({
      inboundId: z.string().min(1).max(128),
      taskId: z.string().min(1).max(128).describe("The real task id returned by create_task"),
    }),
    handler: async (args: { inboundId: string; taskId: string }) => {
      const reviewerTaskId = process.env.TOWER_TASK_ID?.trim();
      if (!reviewerTaskId) return { error: "confirm_gateway_task_created must run inside the bound Workbench terminal" };
      const res = await fetch(GATEWAY_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "task_created", reviewerTaskId, ...args }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { error: (data as { error?: unknown }).error ?? "task confirmation failed", status: res.status };
    },
  },

  complete_gateway_work: {
    description:
      "Workbench-only: after reviewing and accepting a gateway-created child task, reply to the original external " +
      "thread with the task title, reviewed result, commit id/message, branch, and Tower task locator. Tower " +
      "requires the caller to be the bound Workbench and the task to be IN_REVIEW (or already DONE for recovery). " +
      "This call atomically moves an accepted IN_REVIEW task to DONE and creates its retryable FINAL_RESULT outbox; " +
      "do not call move_task(DONE) first. Repeated callbacks are idempotent.",
    schema: z.object({
      inboundId: z.string().min(1).max(128),
      taskId: z.string().min(1).max(128),
      resultSummary: z.string().min(1).max(8000).optional(),
    }),
    handler: async (args: { inboundId: string; taskId: string; resultSummary?: string }) => {
      const reviewerTaskId = process.env.TOWER_TASK_ID?.trim();
      if (!reviewerTaskId) return { error: "complete_gateway_work must run inside the bound Workbench terminal" };
      const res = await fetch(GATEWAY_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "final", reviewerTaskId, ...args }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { error: (data as { error?: unknown }).error ?? "final gateway delivery failed", status: res.status };
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
      taskId: z.string().optional().describe("The current task id (TOWER_TASK_ID); defaults to the terminal's TOWER_TASK_ID when present"),
      question: z.string().min(1).max(4000).describe("The question / options for the human"),
    }),
    handler: async (args: { taskId?: string; question: string }) => {
      const bound = resolveTaskForCurrentTerminal(args.taskId);
      if ("error" in bound) return { error: bound.error, taskId: args.taskId };
      const { taskId } = bound;

      const res = await fetch(`${BRIDGE}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId, question: args.question }),
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
      // No notify channel configured → cannot push outbound. Tell the agent to guide the user to the settings page.
      if (data.noChannelConfigured) {
        return {
          ...base,
          noChannelConfigured: true,
          message:
            "Question recorded (visible in Tower's /harness panel) and task parked, but NO notify " +
            "channel is configured, so it cannot be pushed to any external channel. Before stopping, " +
            "tell the user to configure a channel under Settings -> Notifications -> unattended channels; otherwise Tower cannot send externally.",
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
      taskId: z.string().optional().describe("The current task id (TOWER_TASK_ID); defaults to the terminal's TOWER_TASK_ID when present"),
      message: z.string().min(1).max(4000).describe("The progress update for the human"),
    }),
    handler: async (args: { taskId?: string; message: string }) => {
      const bound = resolveTaskForCurrentTerminal(args.taskId);
      if ("error" in bound) return { error: bound.error, taskId: args.taskId };
      const { taskId } = bound;

      const res = await fetch(`${BRIDGE}/notify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId, message: args.message }),
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
      taskId: z.string().optional().describe("The task that is parked waiting for a reply (its TOWER_TASK_ID); defaults to the terminal's TOWER_TASK_ID when present"),
      text: z.string().min(1).max(8000).describe("The human's reply to inject into the task"),
    }),
    handler: async (args: { taskId?: string; text: string }) => {
      const bound = resolveTaskForCurrentTerminal(args.taskId);
      if ("error" in bound) return { error: bound.error, taskId: args.taskId };
      const { taskId } = bound;

      const res = await fetch(`${BRIDGE}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // allowRetry:false — only answer questions still OPEN; a later message returns no_pending for the bridge to handle as a normal message.
        body: JSON.stringify({ taskId, text: args.text, allowRetry: false }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      // 409 = the task has no pending ask — not an error; tell the caller to handle it as a normal message.
      if (res.status === 409) return { no_pending: true, taskId };
      if (!res.ok) return { error: data?.error ?? "reply failed", status: res.status };

      return { ok: true, taskId, mode: data.mode, injected: data.injected, deduped: data.deduped };
    },
  },
};

async function getOpenAskForRelay(taskId: string): Promise<boolean> {
  const res = await fetch(`${BRIDGE}/pending?taskId=${encodeURIComponent(taskId)}`);
  if (!res.ok) return false;
  const data = (await res.json().catch(() => ({}))) as { pending?: boolean };
  return !!data.pending;
}

function normalizeChannelId(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .replace(/^(feishu|lark|wechat|weixin):/i, "")
    .toLowerCase();
}

async function resolveScopeFromInboundChat(
  platform?: string,
  chatId?: string,
): Promise<"work" | "unattended" | null> {
  const normalizedChatId = normalizeChannelId(chatId);
  if (!normalizedChatId) return null;
  const normalizedPlatform = String(platform ?? "").trim().toLowerCase();
  const { readConfigValue } = await import("@/lib/config-reader");
  const targets = await readConfigValue<NotifyTargetConfig[]>("harness.targets", []);
  for (const target of Array.isArray(targets) ? targets : []) {
    if (!target?.active) continue;
    const targetPlatform = String(target.downstream || target.gateway || "").trim().toLowerCase();
    if (normalizedPlatform && targetPlatform && ![targetPlatform, target.gateway, target.downstream].includes(normalizedPlatform)) {
      continue;
    }
    if (normalizeChannelId(target.dest) === normalizedChatId) {
      return (target.scope ?? "unattended") === "work" ? "work" : "unattended";
    }
  }
  const destinations = await readConfigValue<Array<{ dest?: string; platform?: string; downstream?: string; scope?: string }>>("harness.destinations", []);
  for (const destination of Array.isArray(destinations) ? destinations : []) {
    const targetPlatform = String(destination.platform || destination.downstream || "").trim().toLowerCase();
    if (normalizedPlatform && targetPlatform && targetPlatform !== normalizedPlatform) continue;
    if (normalizeChannelId(destination.dest) === normalizedChatId) {
      return (destination.scope ?? "work") === "unattended" ? "unattended" : "work";
    }
  }
  return null;
}

async function buildExternalReplyText(
  taskId: string,
  args: {
    text: string;
    platform?: string;
    chatId?: string;
    platformMessageId?: string;
  },
): Promise<string> {
  const { db } = await import("@/lib/db");
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, parentTaskId: true },
  });
  let parent: { id: string; title: string } | null = null;
  if (task?.parentTaskId) {
    parent = await db.task.findUnique({
      where: { id: task.parentTaskId },
      select: { id: true, title: true },
    });
  }

  const source = [
    args.platform?.trim() ? `Platform: ${args.platform.trim()}` : null,
    args.chatId?.trim() ? `Chat: ${args.chatId.trim()}` : null,
    args.platformMessageId?.trim() ? `Platform message ID: ${args.platformMessageId.trim()}` : null,
  ].filter(Boolean).join("\n");

  return [
    "[External Channel Reply]",
    `Task: ${task?.title?.trim() || "(unknown)"}`,
    `Task ID: [[tower:task=${taskId}]]`,
    parent ? `Parent task: ${parent.title}\nParent task ID: [[tower:task=${parent.id}]]` : null,
    source ? `Source:\n${source}` : null,
    `Reply:\n${args.text.trim()}`,
    "Continue the current task based on this external reply. If this is a child task, act only on what this child task needs; if the parent needs to know, use Tower's parent/child handoff flow.",
    "Language rule: when replying to the human or summarizing this reply externally, use the human's language. If the language is unclear, use the language of the reply above.",
  ].filter(Boolean).join("\n\n");
}
