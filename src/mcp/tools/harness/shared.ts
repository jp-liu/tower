import { extractTowerTaskId, findHarnessDeliveryByPlatformMessageId } from "@/lib/harness/delivery-map";
import { readHarnessGatewayRuntimeConfig } from "@/lib/harness/gateway-config";
import { signedInternalFetch as fetch } from "@/lib/internal-api-signing";

export { parseGatewaySendOutput } from "@/lib/harness/gateway-output";
export { fetch, readHarnessGatewayRuntimeConfig };

const PORT = process.env.PORT ?? "3000";
export const BRIDGE = `http://localhost:${PORT}/api/internal/harness`;
export const GATEWAY_BRIDGE = `${BRIDGE}/gateway`;
export const GATEWAY_QUERY_BRIDGE = `${BRIDGE}/gateway-query`;
export const GATEWAY_TASK_BRIDGE = `${BRIDGE}/gateway-task`;
export const GATEWAY_DIAGNOSTICS_BRIDGE = `${BRIDGE}/gateway-diagnostics`;
export const GATEWAY_RUNTIME_HEALTH_BRIDGE = `${BRIDGE}/gateway-runtime-health`;
export const GATEWAY_ACCESS_BRIDGE = `${BRIDGE}/gateway-access`;
export const CAPABILITY_BRIDGE = `${BRIDGE}/capabilities`;
export const HARNESS_OUTBOUND_BRIDGE = `${BRIDGE}/outbound`;
export const REMOTE_PROJECT_BRIDGE = `${BRIDGE}/remote-project`;
export const WORKBENCH_BATCH_BRIDGE = `http://localhost:${PORT}/api/internal/workbench/batch`;
const CUID_RE = /^c[a-z0-9]{20,30}$/;

function validateMcpTaskId(taskId: string): string | null {
  if (!CUID_RE.test(taskId)) return "Invalid taskId format — expected CUID";
  return null;
}

export function resolveTaskForCurrentTerminal(taskId?: string): { taskId: string } | { error: string } {
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
 * The tower-bridge / tower-goal skills call list_notify_targets and follow its
 * instructions. Supported channels go through push_to_human's durable outbox;
 * callers must not derive or invoke a direct platform-MCP fallback.
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

export function buildTowerOutboundPresentation(args: {
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

export function buildTowerOutboundText(args: {
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

export function composeSendInstructions(
  active: NotifyTargetConfig,
  token: string,
  scope: "work" | "unattended",
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
  return [
    `Channel class: ${scope === "work" ? "work" : "unattended"}`,
    `Unsupported gateway: ${active.label ?? gw}`,
    "Do NOT send or look up a destination through a platform MCP.",
    "Configure an active Hermes or OpenClaw channel under Settings → Notifications.",
  ].join("\n");
}

export async function resolveActiveTarget(taskId: string, explicitScope?: "work" | "unattended") {
  const { db } = await import("@/lib/db");
  const { readUnattendedGoalMode } = await import("@/lib/unattended-goal/runtime");
  const resolved = await readUnattendedGoalMode(db, taskId).catch(() => null);
  if (!resolved) return { error: "task not found" as const };
  const task = resolved.task;
  const scope: "work" | "unattended" = explicitScope
    ?? (resolved.active ? "unattended" : "work");
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
