import { z } from "zod";
import { readHarnessGatewayRuntimeConfig } from "@/lib/harness/gateway-config";
import { readOpenClawCapabilityJob } from "@/lib/gateway/openclaw-task-client";

export const gatewayCapabilityTools = {
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
