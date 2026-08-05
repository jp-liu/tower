import { z } from "zod";
import { BRIDGE, GATEWAY_ACCESS_BRIDGE, GATEWAY_BRIDGE, GATEWAY_TASK_BRIDGE, GATEWAY_DIAGNOSTICS_BRIDGE, REMOTE_PROJECT_BRIDGE, fetch, relayChannelReply, resolveTaskForCurrentTerminal } from "./shared";

export const gatewayOwnerTools = {
  manage_gateway_channel_access: {
    description:
      "OWNER-only management for the current gateway group. Tower resolves gateway, platform, chat, and verified " +
      "sender from gatewayInboundId; never ask the user to provide an id. authorize grants all-workspace read-only " +
      "access to group members; bind_workspace/bind_projects authorize and replace the scope; unbind returns to ALL; " +
      "revoke denies non-owners. chatName is display-only and never participates in authorization.",
    schema: z.object({
      action: z.enum(["authorize", "bind_workspace", "bind_projects", "unbind", "revoke", "get"]),
      gatewayInboundId: z.string().min(1).max(128),
      workspace: z.string().min(1).max(512).optional(),
      projects: z.array(z.string().min(1).max(512)).min(1).max(50).optional(),
      chatName: z.string().min(1).max(160).optional(),
    }),
    handler: async (args: {
      action: "authorize" | "bind_workspace" | "bind_projects" | "unbind" | "revoke" | "get";
      gatewayInboundId: string;
      workspace?: string;
      projects?: string[];
      chatName?: string;
    }) => {
      const res = await fetch(GATEWAY_ACCESS_BRIDGE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok
        ? data
        : { error: (data as { error?: unknown }).error ?? "gateway channel access failed", status: res.status };
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
      "work and project discussions are durably queued for the resident Workbench with distinct event types. " +
      "A discussion never creates a child task; only a later explicit create/start request becomes project work. " +
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
      chatName: z.string().max(160).optional().describe("Display-only group name from gateway context; never used as identity"),
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
      chatName?: string;
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
