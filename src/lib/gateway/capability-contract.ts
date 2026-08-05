import { createHash } from "node:crypto";
import { z } from "zod";

export const CAPABILITY_SCHEMA_VERSION = 1 as const;
export const OWNER_MESSAGE_CAPABILITY = "human.message.send" as const;

const capabilityNameSchema = z.string().trim().min(1).max(128)
  .regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){2,7}$/);
const capabilityRiskSchema = z.enum(["R0", "R1", "R2", "R3"]);

export const capabilityRequestSchema = z.object({
  schemaVersion: z.literal(CAPABILITY_SCHEMA_VERSION),
  requestId: z.string().uuid(),
  capability: capabilityNameSchema,
  lane: z.enum(["DIRECT", "JOB"]),
  risk: capabilityRiskSchema,
  authorizationRef: z.string().trim().min(1).max(128).optional(),
  inputs: z.record(z.string(), z.unknown()),
  expectedOutput: z.object({
    summary: z.boolean().default(true),
    evidence: z.array(z.string().trim().min(1).max(128)).max(16).default([]),
  }).strict(),
  towerContext: z.object({
    taskId: z.string().trim().min(1).max(128),
    projectId: z.string().trim().min(1).max(128).optional(),
  }).strict(),
  constraints: z.array(z.string().trim().min(1).max(512)).max(32).default([]),
}).strict().superRefine((value, ctx) => {
  if ((value.risk === "R2" || value.risk === "R3") && !value.authorizationRef) {
    ctx.addIssue({ code: "custom", path: ["authorizationRef"], message: `${value.risk} requires authorizationRef` });
  }
  if (value.lane === "DIRECT") {
    if (value.capability !== OWNER_MESSAGE_CAPABILITY || value.risk !== "R2") {
      ctx.addIssue({ code: "custom", path: ["capability"], message: "Unsupported DIRECT capability" });
    }
    const result = ownerMessageInputs.safeParse(value.inputs);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ ...issue, path: ["inputs", ...issue.path] });
      }
    }
  }
  if (value.capability === OWNER_MESSAGE_CAPABILITY && value.lane !== "DIRECT") {
    ctx.addIssue({ code: "custom", path: ["lane"], message: "human.message.send is DIRECT only" });
  }
});

export type CapabilityRequestEnvelope = z.infer<typeof capabilityRequestSchema>;

export const capabilityResultStates = [
  "PENDING",
  "ACCEPTED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
  "EXPIRED",
  "SIDE_EFFECT_UNKNOWN",
] as const;

export type CapabilityResultState = (typeof capabilityResultStates)[number];

export interface CapabilityRequestSnapshot {
  schemaVersion: 1;
  requestId: string;
  capability: string;
  lane: "DIRECT" | "JOB";
  risk: "R0" | "R1" | "R2" | "R3";
  status: CapabilityResultState;
  revision: string;
  summary: string | null;
  evidence: string[];
  gateway: string | null;
  jobRef: string | null;
  updatedAt: string;
}

export const ownerMessageInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1, maxLength: 4_000 },
    expectReply: { type: "boolean", default: false },
    goalTerminal: { type: "string", enum: ["COMPLETED", "BLOCKED"] },
  },
} as const;

const ownerMessageInputs = z.object({
  message: z.string().trim().min(1).max(4_000),
  expectReply: z.boolean().optional(),
  goalTerminal: z.enum(["COMPLETED", "BLOCKED"]).optional(),
}).strict();

export const capabilityResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["requestId", "status", "revision", "updatedAt"],
  properties: {
    requestId: { type: "string", format: "uuid" },
    status: { type: "string", enum: capabilityResultStates },
    revision: { type: "string" },
    summary: { type: ["string", "null"] },
    evidence: { type: "array", items: { type: "string" } },
    gateway: { type: ["string", "null"] },
    jobRef: { type: ["string", "null"] },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export function capabilityEnvelopeDigest(envelope: CapabilityRequestEnvelope): string {
  return createHash("sha256").update(JSON.stringify(sortJson(envelope))).digest("hex");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, sortJson(child)]));
}

export function parseEvidence(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
