import { z } from "zod";
import { readHarnessGatewayRuntimeConfig } from "@/lib/harness/gateway-config";
import { readOpenClawCapabilityJob } from "@/lib/gateway/openclaw-task-client";
import { capabilityRequestSchema } from "@/lib/gateway/capability-contract";
import { CAPABILITY_BRIDGE, fetch, resolveTaskForCurrentTerminal } from "./harness/shared";

export const gatewayCapabilityTools = {
  discover_gateway_capabilities: {
    description:
      "Discover the configured deterministic Gateway capability surface, including executable input/output schemas " +
      "and whether this task has a valid bounded OWNER grant. Discovery never returns channel credentials or the " +
      "OWNER destination.",
    schema: z.object({
      taskId: z.string().optional().describe("Current Tower task id; defaults to TOWER_TASK_ID"),
    }),
    handler: async (args: { taskId?: string }) => {
      const bound = resolveTaskForCurrentTerminal(args.taskId);
      if ("error" in bound) return { error: bound.error };
      const url = new URL(CAPABILITY_BRIDGE);
      url.searchParams.set("taskId", bound.taskId);
      const response = await fetch(url);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { error: (data as { error?: unknown }).error ?? "Capability discovery failed" };
      return data;
    },
  },
  submit_capability_request: {
    description:
      "Submit one versioned external CapabilityRequest through the deterministic Gateway adapter. The first " +
      "lane sends DIRECT human.message.send to the fixed OWNER home route; configured JOB capabilities are routed " +
      "privately by the OpenClaw plugin. The caller cannot choose a concrete destination or Operator, and R2/R3 " +
      "submission fails closed without a Tower-UI-issued bounded authorizationRef. Reusing requestId is idempotent; " +
      "changing its payload is rejected.",
    schema: capabilityRequestSchema,
    handler: async (args: z.infer<typeof capabilityRequestSchema>) => {
      const bound = resolveTaskForCurrentTerminal(args.towerContext.taskId);
      if ("error" in bound) return { error: bound.error };
      const response = await fetch(CAPABILITY_BRIDGE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { error: (data as { error?: unknown }).error ?? "Capability submission failed" };
      return data;
    },
  },
  get_capability_request_status: {
    description:
      "Read Tower's minimal correlation/result snapshot for a previously submitted CapabilityRequest. This is " +
      "read-only and never retries an unknown side effect.",
    schema: z.object({
      requestId: z.string().uuid(),
      taskId: z.string().optional().describe("Current Tower task id; defaults to TOWER_TASK_ID"),
    }),
    handler: async (args: { requestId: string; taskId?: string }) => {
      const bound = resolveTaskForCurrentTerminal(args.taskId);
      if ("error" in bound) return { error: bound.error };
      const url = new URL(CAPABILITY_BRIDGE);
      url.searchParams.set("requestId", args.requestId);
      url.searchParams.set("taskId", bound.taskId);
      const response = await fetch(url);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { error: (data as { error?: unknown }).error ?? "Capability status read failed" };
      return data;
    },
  },
  get_capability_job_status: {
    description:
      "Read the authoritative status of an external capability Job for recovery or reconciliation. " +
      "This is read-only: it never creates, resumes, cancels, retries, or mutates the Job. " +
      "OpenClaw accepts either its taskId or runId as jobRef.",
    schema: z.object({
      gateway: z.enum(["openclaw"]),
      jobRef: z.string().min(1).max(256),
    }),
    handler: async (args: { gateway: "openclaw"; jobRef: string }) => {
      const config = await readHarnessGatewayRuntimeConfig(args.gateway);
      return readOpenClawCapabilityJob(args.jobRef, config.env);
    },
  },
};
