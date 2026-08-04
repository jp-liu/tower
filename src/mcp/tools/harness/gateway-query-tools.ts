import { z } from "zod";
import { GATEWAY_BRIDGE, GATEWAY_QUERY_BRIDGE, fetch } from "./shared";

export const gatewayQueryTools = {
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
      chatName: z.string().max(160).optional().describe("Display-only group name from gateway context"),
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
      chatName?: string;
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
};
