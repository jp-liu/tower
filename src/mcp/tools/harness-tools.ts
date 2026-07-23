import { z } from "zod";
import { extractTowerTaskId, findHarnessDeliveryByPlatformMessageId, recordHarnessDelivery } from "@/lib/harness/delivery-map";
import { readHarnessGatewayRuntimeConfig } from "@/lib/harness/gateway-config";

const PORT = process.env.PORT ?? "3000";
const BRIDGE = `http://localhost:${PORT}/api/internal/harness`;
const TERMINAL_BRIDGE = `http://localhost:${PORT}/api/internal/terminal`;
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
      "Atomically push a task message to the configured human channel, then record it in Tower. " +
      "For Hermes/OpenClaw channels, this tool sends through the gateway CLI first; only if the send succeeds does it " +
      "call ask_human (park, when expectReply=true) or notify_human (record only). Use this instead of manually " +
      "sending + ask_human for gateway-backed work/unattended channels.",
    schema: z.object({
      taskId: z.string().optional().describe("The current task id (TOWER_TASK_ID); defaults to the terminal's TOWER_TASK_ID when present"),
      message: z.string().min(1).max(4000).describe("Message body to send to the human/group"),
      scope: z.enum(["work", "unattended"]).optional().describe("Channel scope. Omit to derive from goal mode."),
      to: z.string().optional().describe("Destination for work messages: group/person name, Tower alias, or platform id. Optional for unattended home routes."),
      expectReply: z.boolean().optional().describe("If true, record with ask_human and park. Defaults true for unattended, false for work."),
    }),
    handler: async (args: { taskId?: string; message: string; scope?: "work" | "unattended"; to?: string; expectReply?: boolean }) => {
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
      const { sendViaHarnessGateway } = await import("@/lib/harness/gateway-send");
      const sent = await sendViaHarnessGateway({
        gateway: active.gateway,
        message: body,
        presentation,
        dest: active.dest,
        to: args.to,
        downstream: active.downstream,
        profile: active.profile,
        scope,
      });
      if (!sent.ok) return { error: `${active.gateway} send failed`, output: sent.output };

      const expectReply = args.expectReply ?? scope === "unattended";
      const endpoint = expectReply ? "ask" : "notify";
      const payload = expectReply
        ? { taskId, question: args.message }
        : { taskId, message: args.message };
      const res = await fetch(`${BRIDGE}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { error: data?.error ?? `${endpoint} failed`, status: res.status, sent: true };
      const sentMeta = parseGatewaySendOutput(sent.output);
      const harnessMessageId = String((expectReply ? data.requestId : data.messageId) || "");
      if (sentMeta?.message_id && harnessMessageId) {
        await recordHarnessDelivery({
          harnessMessageId,
          taskId,
          platform: sentMeta.platform || active.downstream || "hermes",
          chatId: sentMeta.chat_id || sent.resolvedDest || active.dest || args.to || "",
          platformMessageId: sentMeta.message_id,
          scope,
          expectReply,
        });
      }
      return {
        ok: true,
        sent: true,
        parked: expectReply,
        scope,
        requestId: data.requestId,
        messageId: data.messageId,
        output: sent.output,
      };
    },
  },

  relay_channel_reply: {
    description:
      "Bridge a human reply from Feishu/WeChat/Hermes back into Tower. Use this for any inbound platform " +
      "message that contains or quotes a [[tower:task=...]] token. If the reply references a Hermes-sent " +
      "platform message id, Tower uses the stored delivery mapping to decide whether to answer an ask_human " +
      "or inject the reply into the live task terminal for work-channel discussion.",
    schema: z.object({
      text: z.string().min(1).max(8000).describe("The human's reply text"),
      taskId: z.string().optional().describe("Task id if already parsed from the token"),
      platform: z.string().optional().describe("Inbound platform, e.g. feishu or weixin"),
      chatId: z.string().optional().describe("Inbound chat id, e.g. Feishu oc_xxx. Helps disambiguate work group replies from unattended DM replies."),
      platformMessageId: z.string().optional().describe("The Feishu/WeChat message id being replied to, if available"),
      quotedText: z.string().optional().describe("Quoted/replied-to message text, if available"),
    }),
    handler: async (args: { text: string; taskId?: string; platform?: string; chatId?: string; platformMessageId?: string; quotedText?: string }) => {
      const delivery = args.platformMessageId
        ? await findHarnessDeliveryByPlatformMessageId(args.platformMessageId)
        : null;
      const taskId = delivery?.taskId || args.taskId || extractTowerTaskId(args.quotedText) || extractTowerTaskId(args.text);
      if (!taskId) {
        return { error: "No tower task token found", no_task_token: true };
      }
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

      const injected = await injectChannelReply(taskId, replyText);
      if (injected.ok) return { ok: true, mode: "terminal_reply", taskId, delivery, chatScope, resumed: injected.resumed };
      return { error: injected.error, status: injected.status, taskId, delivery, chatScope };
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

export function parseGatewaySendOutput(output: string): { platform?: string; chat_id?: string; message_id?: string } | null {
  try {
    const parsed = JSON.parse(output) as unknown;
    const messageId =
      findStringByKeys(parsed, ["message_id", "messageId", "platformMessageId", "openMessageId"]) ??
      findStringByPattern(parsed, /^om_[A-Za-z0-9_-]+$/);
    if (!messageId) return null;
    return {
      platform: findStringByKeys(parsed, ["platform", "channel", "downstream"]),
      chat_id: findStringByKeys(parsed, ["chat_id", "chatId", "target", "to", "destination"]),
      message_id: messageId,
    };
  } catch {
    const messageId =
      output.match(/\b(message_id|messageId|platformMessageId|\u98de\u4e66\u6d88\u606f\s*ID|message\s*id)\b[^A-Za-z0-9_-]*(om_[A-Za-z0-9_-]+)/i)?.[2] ??
      output.match(/\bom_[A-Za-z0-9_-]+\b/)?.[0];
    if (!messageId) return null;
    const platform = output.match(/\b(platform|channel)\b[^A-Za-z0-9_-]*([A-Za-z0-9_-]+)/i)?.[2];
    const chatId =
      output.match(/\b(chat_id|chatId|target|to)\b[^A-Za-z0-9:_-]*([A-Za-z]+:[A-Za-z0-9:_-]+)/i)?.[2] ??
      output.match(/\b(chat_id|chatId|target|to)\b[^A-Za-z0-9:_-]*(oc_[A-Za-z0-9_-]+)/i)?.[2];
    return {
      ...(platform ? { platform } : {}),
      ...(chatId ? { chat_id: chatId } : {}),
      message_id: messageId,
    };
  }
}

function findStringByKeys(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKeys(item, keys);
      if (found) return found;
    }
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  for (const key of keys) {
    const raw = obj[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  for (const raw of Object.values(obj)) {
    const found = findStringByKeys(raw, keys);
    if (found) return found;
  }
  return undefined;
}

function findStringByPattern(value: unknown, pattern: RegExp): string | undefined {
  if (typeof value === "string" && pattern.test(value)) return value;
  if (!value || typeof value !== "object") return undefined;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (const child of children) {
    const found = findStringByPattern(child, pattern);
    if (found) return found;
  }
  return undefined;
}

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

async function injectChannelReply(taskId: string, text: string): Promise<{ ok: true; resumed: boolean } | { ok: false; error: unknown; status?: number }> {
  const first = await postTerminalInput(taskId, text);
  if (first.ok) return { ok: true, resumed: false };
  if (first.status !== 404) return first;

  if (await getOpenAskForRelay(taskId)) {
    return {
      ok: false,
      status: 409,
      error: "Task is parked on an open ask_human question; refusing to resume for a work-channel reply.",
    };
  }

  const resume = await fetch(`${TERMINAL_BRIDGE}/${encodeURIComponent(taskId)}/resume`, { method: "POST" });
  if (!resume.ok) {
    const data = (await resume.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: false, status: resume.status, error: data?.error ?? "resume failed" };
  }

  await new Promise((r) => setTimeout(r, 2500));
  for (let i = 0; i < 20; i++) {
    const retry = await postTerminalInput(taskId, text);
    if (retry.ok) return { ok: true, resumed: true };
    await new Promise((r) => setTimeout(r, 800));
  }
  return { ok: false, status: 404, error: "terminal not ready after resume" };
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

async function postTerminalInput(taskId: string, text: string): Promise<{ ok: true } | { ok: false; error: unknown; status: number }> {
  const res = await fetch(`${TERMINAL_BRIDGE}/${encodeURIComponent(taskId)}/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, submit: true }),
  });
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: false, status: res.status, error: data?.error ?? "terminal inject failed" };
}
