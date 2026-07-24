import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AI_CAPABILITY_SLOTS,
  isAiCapabilitySlot,
  type AiCapabilitySlot,
  type CapabilityAttemptSummary,
} from "@tower/ai-runtime";
import { db } from "@/lib/db";

export type CapabilityServiceErrorCode =
  | "invalid_input"
  | "invalid_slot"
  | "connection_not_found"
  | "connection_kind_not_allowed"
  | "model_required"
  | "duplicate_target"
  | "target_not_found";

const SAFE_MESSAGES: Record<CapabilityServiceErrorCode, string> = {
  invalid_input: "The capability configuration is invalid",
  invalid_slot: "The AI capability slot is invalid",
  connection_not_found: "The selected connection no longer exists",
  connection_kind_not_allowed: "The selected connection type is not allowed for this slot",
  model_required: "API targets require a model ID",
  duplicate_target: "The same connection and model cannot be added twice",
  target_not_found: "The capability target no longer exists",
};

export class CapabilityServiceError extends Error {
  constructor(public readonly code: CapabilityServiceErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "CapabilityServiceError";
  }
}

const slotSchema = z.enum(AI_CAPABILITY_SLOTS);
const targetInputSchema = z.object({
  targetId: z.string().trim().min(1).max(200).optional(),
  connectionId: z.string().trim().min(1).max(200),
  modelId: z.string().trim().max(300).nullable().optional(),
});
const targetListSchema = z.array(targetInputSchema).max(50);

export type CapabilityTargetInput = z.input<typeof targetInputSchema>;

const targetInclude = {
  connection: {
    select: {
      id: true,
      connectionKey: true,
      name: true,
      kind: true,
      provider: true,
      enabled: true,
      testStatus: true,
      testOk: true,
      defaultModelId: true,
    },
  },
} as const;

function parseSlot(slot: string): AiCapabilitySlot {
  if (!isAiCapabilitySlot(slot)) throw new CapabilityServiceError("invalid_slot");
  return slot;
}

function normalizeModelId(modelId: string | null | undefined): string | null {
  const normalized = modelId?.trim();
  return normalized ? normalized : null;
}

function makeTargetKey(connectionId: string, modelId: string | null): string {
  return JSON.stringify([connectionId, modelId]);
}

function normalizeUnknownError(error: unknown): never {
  if (error instanceof CapabilityServiceError) throw error;
  if (error instanceof z.ZodError) throw new CapabilityServiceError("invalid_input");
  throw error;
}

export async function listCapabilityConfigsService() {
  const configs = await db.aiCapabilityConfig.findMany({
    include: { targets: { include: targetInclude, orderBy: { order: "asc" } } },
  });
  const bySlot = new Map(configs.map((config) => [config.slot, config]));
  return AI_CAPABILITY_SLOTS.map((slot) => {
    const config = bySlot.get(slot);
    return config ?? {
      id: null,
      slot,
      provider: "claude",
      mode: "cli",
      model: null,
      migrationStatus: "missing",
      createdAt: null,
      updatedAt: null,
      targets: [],
    };
  });
}

export async function getCapabilityConfigService(slotInput: string) {
  const slot = parseSlot(slotInput);
  const config = await db.aiCapabilityConfig.findUnique({
    where: { slot },
    include: { targets: { include: targetInclude, orderBy: { order: "asc" } } },
  });
  return config ?? {
    id: null,
    slot,
    provider: "claude",
    mode: "cli",
    model: null,
    migrationStatus: "missing",
    createdAt: null,
    updatedAt: null,
    targets: [],
  };
}

async function validateTargets(slot: AiCapabilitySlot, inputs: CapabilityTargetInput[]) {
  let parsed: z.output<typeof targetListSchema>;
  try {
    parsed = targetListSchema.parse(inputs);
  } catch (error) {
    return normalizeUnknownError(error);
  }
  const connectionIds = [...new Set(parsed.map((target) => target.connectionId))];
  const connections = await db.providerConnection.findMany({
    where: { id: { in: connectionIds } },
    select: { id: true, kind: true, provider: true },
  });
  const byId = new Map(connections.map((connection) => [connection.id, connection]));
  const seen = new Set<string>();
  const targetIds = new Set<string>();
  return parsed.map((target) => {
    const connection = byId.get(target.connectionId);
    if (!connection) throw new CapabilityServiceError("connection_not_found");
    if (connection.kind !== "cli" && connection.kind !== "api") {
      throw new CapabilityServiceError("connection_kind_not_allowed");
    }
    if (slot === "terminal" && connection.kind !== "cli") {
      throw new CapabilityServiceError("connection_kind_not_allowed");
    }
    const modelId = normalizeModelId(target.modelId);
    if (connection.kind === "api" && !modelId) throw new CapabilityServiceError("model_required");
    const targetKey = makeTargetKey(connection.id, modelId);
    if (seen.has(targetKey)) throw new CapabilityServiceError("duplicate_target");
    seen.add(targetKey);
    const id = target.targetId ?? randomUUID();
    if (targetIds.has(id)) throw new CapabilityServiceError("invalid_input");
    targetIds.add(id);
    return {
      id,
      connectionId: connection.id,
      modelId,
      targetKey,
      connection,
    };
  });
}

export async function replaceCapabilityTargetsService(
  slotInput: string,
  inputs: CapabilityTargetInput[],
) {
  const slot = parseSlot(slotInput);
  const targets = await validateTargets(slot, inputs);
  try {
    await db.$transaction(async (transaction) => {
      const primary = targets[0];
      const config = await transaction.aiCapabilityConfig.upsert({
        where: { slot },
        create: {
          slot,
          provider: primary?.connection.provider ?? "claude",
          mode: primary?.connection.kind ?? "cli",
          model: primary?.modelId ?? null,
          migrationStatus: "complete",
        },
        update: {
          ...(primary ? {
            provider: primary.connection.provider,
            mode: primary.connection.kind,
            model: primary.modelId,
          } : {}),
          migrationStatus: "complete",
        },
      });
      await transaction.aiCapabilityTarget.deleteMany({ where: { capabilityConfigId: config.id } });
      for (const [order, target] of targets.entries()) {
        await transaction.aiCapabilityTarget.create({
          data: {
            id: target.id,
            capabilityConfigId: config.id,
            connectionId: target.connectionId,
            modelId: target.modelId,
            targetKey: target.targetKey,
            order,
          },
        });
      }
    });
  } catch (error) {
    return normalizeUnknownError(error);
  }
  return getCapabilityConfigService(slot);
}

export async function addCapabilityTargetService(slot: string, input: CapabilityTargetInput) {
  const config = await getCapabilityConfigService(slot);
  return replaceCapabilityTargetsService(slot, [
    ...config.targets.map((target) => ({
      targetId: target.id,
      connectionId: target.connectionId,
      modelId: target.modelId,
    })),
    input,
  ]);
}

export async function updateCapabilityTargetService(
  slot: string,
  targetId: string,
  input: Omit<CapabilityTargetInput, "targetId">,
) {
  const config = await getCapabilityConfigService(slot);
  if (!config.targets.some((target) => target.id === targetId)) {
    throw new CapabilityServiceError("target_not_found");
  }
  return replaceCapabilityTargetsService(slot, config.targets.map((target) => target.id === targetId
    ? { targetId, ...input }
    : { targetId: target.id, connectionId: target.connectionId, modelId: target.modelId }));
}

export async function deleteCapabilityTargetService(slot: string, targetId: string) {
  const config = await getCapabilityConfigService(slot);
  if (!config.targets.some((target) => target.id === targetId)) {
    throw new CapabilityServiceError("target_not_found");
  }
  return replaceCapabilityTargetsService(slot, config.targets
    .filter((target) => target.id !== targetId)
    .map((target) => ({
      targetId: target.id,
      connectionId: target.connectionId,
      modelId: target.modelId,
    })));
}

export async function reorderCapabilityTargetsService(slot: string, orderedTargetIds: string[]) {
  let ids: string[];
  try {
    ids = z.array(z.string().trim().min(1)).parse(orderedTargetIds);
  } catch (error) {
    return normalizeUnknownError(error);
  }
  if (new Set(ids).size !== ids.length) throw new CapabilityServiceError("invalid_input");
  const config = await getCapabilityConfigService(slot);
  const targets = new Map(config.targets.map((target) => [target.id, target]));
  if (ids.length !== targets.size || ids.some((id) => !targets.has(id))) {
    throw new CapabilityServiceError("invalid_input");
  }
  return replaceCapabilityTargetsService(slot, ids.map((id) => {
    const target = targets.get(id)!;
    return { targetId: target.id, connectionId: target.connectionId, modelId: target.modelId };
  }));
}

export async function listCapabilityChoicesService(slotInput: string) {
  const slot = parseSlot(slotInput);
  return db.providerConnection.findMany({
    where: slot === "terminal" ? { kind: "cli" } : { kind: { in: ["cli", "api"] } },
    select: {
      id: true,
      connectionKey: true,
      name: true,
      kind: true,
      provider: true,
      enabled: true,
      testStatus: true,
      testOk: true,
      defaultModelId: true,
      models: {
        select: { modelId: true, source: true, available: true },
        orderBy: { modelId: "asc" },
      },
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }, { createdAt: "asc" }],
  });
}

export async function recordCapabilityAttemptService(attempt: CapabilityAttemptSummary): Promise<void> {
  await db.aiCapabilityAttempt.create({
    data: {
      requestId: attempt.requestId,
      correlationId: attempt.correlationId ?? null,
      slot: attempt.slot,
      targetId: attempt.targetId,
      connectionId: attempt.connectionId,
      connectionRefId: attempt.connectionId,
      modelId: attempt.modelId ?? null,
      startedAt: attempt.startedAt,
      durationMs: Math.max(0, Math.round(attempt.durationMs)),
      result: attempt.result,
      errorCode: attempt.errorCode ?? null,
      repaired: attempt.repaired ?? false,
    },
  });
}

export async function getCapabilityDiagnosticsService(input: {
  slot?: string;
  requestId?: string;
  correlationId?: string;
  limit?: number;
} = {}) {
  let parsed: {
    slot?: AiCapabilitySlot;
    requestId?: string;
    correlationId?: string;
    limit: number;
  };
  try {
    parsed = z.object({
      slot: slotSchema.optional(),
      requestId: z.string().trim().min(1).max(200).optional(),
      correlationId: z.string().trim().min(1).max(200).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).parse(input);
  } catch (error) {
    return normalizeUnknownError(error);
  }
  return db.aiCapabilityAttempt.findMany({
    where: {
      ...(parsed.slot ? { slot: parsed.slot } : {}),
      ...(parsed.requestId ? { requestId: parsed.requestId } : {}),
      ...(parsed.correlationId ? { correlationId: parsed.correlationId } : {}),
    },
    select: {
      id: true,
      requestId: true,
      correlationId: true,
      slot: true,
      targetId: true,
      connectionId: true,
      modelId: true,
      startedAt: true,
      durationMs: true,
      result: true,
      errorCode: true,
      repaired: true,
    },
    orderBy: { startedAt: "desc" },
    take: parsed.limit,
  });
}
