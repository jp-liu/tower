import { z } from "zod";
import { BRIDGE, HARNESS_OUTBOUND_BRIDGE, buildTowerOutboundPresentation, buildTowerOutboundText, composeSendInstructions, fetch, readHarnessGatewayRuntimeConfig, resolveActiveTarget, resolveTaskForCurrentTerminal } from "./shared";

export const messagingTools = {
  list_notify_targets: {
    description:
      "Read the ACTIVE notify channel of a given SCOPE from Tower's DB (harness.targets) and return " +
      "READY-TO-FOLLOW send instructions for pushing a message to a human — used by the tower-bridge / tower-goal " +
      "skills. Two scopes: 'work' (you're at the keyboard — send to a group/colleague for discussion, don't " +
      "park) and 'unattended' (off-hours — reach you personally, park while waiting). The selected path must use " +
      "push_to_human so Tower's durable outbox performs the external send and records its receipt. Pass the current taskId so the [[tower:task=...]] " +
      "token is filled in. Returns { scope, active, instructions }, or { noChannelConfigured: true } with " +
      "guidance if that scope has no active channel.",
    schema: z.object({
      scope: z
        .enum(["work", "unattended"])
        .optional()
        .describe(
          "Channel class: 'work' (in-office, send to a group) or 'unattended' (off-hours, reach you). " +
            "Pass it when the user explicitly named a destination (group → 'work'). If omitted, it defaults " +
            "from the task's persisted goal runtime: goal mode on → 'unattended', off → 'work'.",
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
      const { scope, active } = resolved;
      if (!active) {
        const hint =
          scope === "work"
            ? "No active channel in the 'work' category. To send to a group, configure one under Settings → Notifications (work column) and mark it active. Do not bypass tower-bridge with a platform MCP."
            : "No active channel in the 'unattended' category, so nothing can be pushed out. Don't pretend you sent it — tell the user to configure one under Settings → Notifications (unattended column) and mark it active.";
        return { scope, noChannelConfigured: true, instructions: hint };
      }
      if (active.gateway !== "hermes" && active.gateway !== "openclaw") {
        return {
          scope,
          capabilityUnavailable: true,
          error: `Notify channel gateway ${active.gateway} is not supported`,
          instructions:
            "Do NOT send or fall back to a platform MCP. Configure an active Hermes or OpenClaw channel under Settings → Notifications.",
        };
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
        instructions: composeSendInstructions(active, token, scope),
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

  ask_human: {
    description:
      "Ask the human operator a question and PARK the task until they reply. " +
      "Call this ONLY when you are blocked on a decision you cannot make yourself, " +
      "or before a dangerous/irreversible action that needs sign-off. " +
      "This ENDS your turn — do NOT keep working after calling it. The task is suspended " +
      "(its terminal is closed to save resources) and later resumed with the human's answer " +
      "as your next message. This tool only RECORDS + parks — to actually reach the human, first push the " +
      "question via the tower-bridge explicit-message path (call list_notify_targets for the active channel), then call this. " +
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
      "first push the note via the tower-bridge explicit-message path (list_notify_targets for the active channel), then call this.",
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
};
