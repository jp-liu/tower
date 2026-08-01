import { z } from "zod";
import { GATEWAY_DIAGNOSTICS_BRIDGE, GATEWAY_RUNTIME_HEALTH_BRIDGE, fetch } from "./shared";

export const operationsTools = {
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
};
