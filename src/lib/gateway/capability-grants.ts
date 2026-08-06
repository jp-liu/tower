import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { OWNER_MESSAGE_CAPABILITY } from "./capability-contract";
import { readOwnerHomeTarget } from "./capability-target";

type GrantStore = Pick<Prisma.TransactionClient, "task" | "capabilityGrant">;
type GrantDb = GrantStore & Pick<PrismaClient, "$transaction">;

const MIN_GRANT_MINUTES = 5;
const MAX_GRANT_MINUTES = 7 * 24 * 60;
const DURATION_ONLY_GRANT = 0;

export interface CapabilityGrantTarget {
  capability: string;
  risk: "R0" | "R1" | "R2" | "R3";
  targetKind: "OWNER_HOME_ROUTE" | "GATEWAY_CAPABILITY_ROUTE";
  targetFingerprint: string;
}

export interface CapabilityGrantSnapshot {
  authorizationRef: string;
  capability: string;
  targetKind: string;
  expiresAt: string;
}

function normalizeGrantInput(input: {
  taskId: string;
  targets: CapabilityGrantTarget[];
  durationMinutes?: number;
}) {
  const durationMinutes = Math.trunc(input.durationMinutes ?? 8 * 60);
  if (durationMinutes < MIN_GRANT_MINUTES || durationMinutes > MAX_GRANT_MINUTES) {
    throw new Error(`Grant duration must be ${MIN_GRANT_MINUTES}-${MAX_GRANT_MINUTES} minutes`);
  }
  if (input.targets.length < 1 || input.targets.length > 64) {
    throw new Error("At least one and at most 64 capability grants are required");
  }
  const unique = new Map(input.targets.map((target) => [target.capability, target]));
  if (unique.size !== input.targets.length) throw new Error("Capability grants must be unique");
  return { durationMinutes };
}

export async function replaceCapabilityGrantsInTransaction(
  input: {
    taskId: string;
    targets: CapabilityGrantTarget[];
    durationMinutes?: number;
  },
  database: GrantStore,
): Promise<CapabilityGrantSnapshot[]> {
  const { durationMinutes } = normalizeGrantInput(input);
  const task = await database.task.findUnique({ where: { id: input.taskId }, select: { id: true } });
  if (!task) throw new Error("task not found");
  const expiresAt = new Date(Date.now() + durationMinutes * 60_000);
  await database.capabilityGrant.updateMany({
    where: { taskId: input.taskId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const grants = [];
  for (const target of input.targets) {
    grants.push(await database.capabilityGrant.create({
      data: {
        taskId: input.taskId,
        capability: target.capability,
        risk: target.risk,
        targetKind: target.targetKind,
        targetFingerprint: target.targetFingerprint,
        issuer: "TOWER_UI",
        maxUses: DURATION_ONLY_GRANT,
        expiresAt,
      },
    }));
  }
  return grants.map((grant) => ({
    authorizationRef: grant.id,
    capability: grant.capability,
    targetKind: grant.targetKind,
    expiresAt: grant.expiresAt.toISOString(),
  }));
}

export async function issueCapabilityGrants(input: {
  taskId: string;
  targets: CapabilityGrantTarget[];
  durationMinutes?: number;
}, database: GrantDb = db): Promise<CapabilityGrantSnapshot[]> {
  normalizeGrantInput(input);
  return database.$transaction((tx) => replaceCapabilityGrantsInTransaction(input, tx));
}

export async function issueOwnerMessageGrant(input: {
  taskId: string;
  durationMinutes?: number;
}, database: GrantDb = db): Promise<{
  authorizationRef: string;
  capability: typeof OWNER_MESSAGE_CAPABILITY;
  targetKind: "OWNER_HOME_ROUTE";
  expiresAt: string;
}> {
  const [task, target] = await Promise.all([
    database.task.findUnique({ where: { id: input.taskId }, select: { id: true } }),
    readOwnerHomeTarget(),
  ]);
  if (!task) throw new Error("task not found");
  if (!target) throw new Error("A fixed unattended OWNER home route is required before issuing a grant");
  const [grant] = await issueCapabilityGrants({
    ...input,
    targets: [{
      capability: OWNER_MESSAGE_CAPABILITY,
      risk: "R2",
      targetKind: "OWNER_HOME_ROUTE",
      targetFingerprint: target.fingerprint,
    }],
  }, database);
  return {
    authorizationRef: grant.authorizationRef,
    capability: OWNER_MESSAGE_CAPABILITY,
    targetKind: "OWNER_HOME_ROUTE",
    expiresAt: grant.expiresAt,
  };
}

export async function revokeCapabilityGrants(taskId: string, database: GrantDb = db): Promise<number> {
  return database.$transaction((tx) => revokeCapabilityGrantsInTransaction(taskId, tx));
}

export async function revokeCapabilityGrantsInTransaction(
  taskId: string,
  database: Pick<Prisma.TransactionClient, "capabilityGrant">,
): Promise<number> {
  const result = await database.capabilityGrant.updateMany({
    where: { taskId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function revokeOwnerMessageGrants(taskId: string, database: GrantDb = db): Promise<number> {
  const result = await database.capabilityGrant.updateMany({
    where: {
      taskId,
      capability: OWNER_MESSAGE_CAPABILITY,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function readActiveCapabilityGrant(
  taskId: string,
  target: CapabilityGrantTarget,
  database: GrantDb = db,
): Promise<{ authorizationRef: string; expiresAt: string } | null> {
  if (target.risk === "R0" || target.risk === "R1") return null;
  const grant = await database.capabilityGrant.findFirst({
    where: {
      taskId,
      capability: target.capability,
      risk: target.risk,
      targetKind: target.targetKind,
      targetFingerprint: target.targetFingerprint,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!grant || (grant.maxUses !== DURATION_ONLY_GRANT && grant.usedCount >= grant.maxUses)) return null;
  return {
    authorizationRef: grant.id,
    expiresAt: grant.expiresAt.toISOString(),
  };
}

export async function readActiveOwnerMessageGrant(
  taskId: string,
  database: GrantDb = db,
): Promise<{
  authorizationRef: string;
  expiresAt: string;
} | null> {
  const target = await readOwnerHomeTarget();
  if (!target) return null;
  const grant = await database.capabilityGrant.findFirst({
    where: {
      taskId,
      capability: OWNER_MESSAGE_CAPABILITY,
      targetKind: "OWNER_HOME_ROUTE",
      targetFingerprint: target.fingerprint,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!grant || (grant.maxUses !== DURATION_ONLY_GRANT && grant.usedCount >= grant.maxUses)) return null;
  return {
    authorizationRef: grant.id,
    expiresAt: grant.expiresAt.toISOString(),
  };
}
