import { z } from "zod";
import { GATEWAY_QUERY_BRIDGE, fetch } from "./shared";

export const gatewayQueryTools = {
  route_gateway_query: {
    description:
      "Run one read-only project query for a non-owner in a trusted channel. This single call validates the " +
      "channel's current project scope, resolves the requested project, and returns bounded project knowledge and " +
      "recent task status. It creates no Gateway inbound/session, Assistant session, task, terminal, or Workbench " +
      "event. Use returned candidates instead of guessing, then answer normally through the gateway.",
    schema: z.object({
      gateway: z.enum(["hermes", "openclaw"]),
      platform: z.string().min(1).max(64),
      chatId: z.string().min(1).max(512),
      senderId: z.string().max(512).optional(),
      project: z.string().max(512).optional(),
      question: z.string().min(1).max(8000),
    }),
    handler: async (args: {
      gateway: "hermes" | "openclaw";
      platform: string;
      chatId: string;
      senderId?: string;
      project?: string;
      question: string;
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
};
