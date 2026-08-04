"use server";

import { db } from "@/lib/db";
import {
  applyUnattendedGoalLifecycleEventInTransaction,
  readUnattendedGoalMode,
} from "@/lib/unattended-goal/runtime";
import {
  replaceCapabilityGrantsInTransaction,
  revokeCapabilityGrantsInTransaction,
} from "@/lib/gateway/capability-grants";
import { discoverGatewayCapabilities } from "@/lib/gateway/capability-runtime";
import { OWNER_MESSAGE_CAPABILITY } from "@/lib/gateway/capability-contract";
import { setUnattendedSignal } from "@/lib/harness/unattended-signal";

export async function getUnattendedGoalControl(taskId: string) {
  const [runtime, discovery] = await Promise.all([
    readUnattendedGoalMode(db, taskId),
    discoverGatewayCapabilities(taskId),
  ]);
  const owner = discovery.capabilities.find((item) => item.capability === OWNER_MESSAGE_CAPABILITY);
  return {
    active: runtime.active,
    runtime: runtime.runtime,
    ownerMessageGrant: owner?.authorization.authorizationRef ? owner.authorization : null,
    capabilities: discovery.capabilities,
  };
}

export async function enableUnattendedGoalFromUi(input: {
  taskId: string;
  durationMinutes?: number;
  maxUses?: number;
  capabilities?: string[];
}) {
  const discovery = await discoverGatewayCapabilities(input.taskId);
  const owner = discovery.capabilities.find((item) => item.capability === OWNER_MESSAGE_CAPABILITY);
  if (!owner?.available || !owner.routeRevision) {
    throw new Error("A fixed unattended OWNER home route is required before enabling unattended mode");
  }
  const selected = new Set(input.capabilities ?? []);
  const unknown = [...selected].find((name) => !discovery.capabilities.some((item) => item.capability === name));
  if (unknown) throw new Error(`Capability is not advertised by the Gateway: ${unknown}`);
  const authorized = discovery.capabilities.filter((item) =>
    item.capability === OWNER_MESSAGE_CAPABILITY
    || selected.has(item.capability)
  ).filter((item) => item.risk === "R2" || item.risk === "R3");
  const durationMinutes = Math.trunc(input.durationMinutes ?? 480);
  const maxCapabilityJobs = Math.trunc(input.maxUses ?? 20);
  const targets = authorized.map((item) => {
    if (!item.available || !item.routeRevision) {
      throw new Error(`Capability is unavailable: ${item.capability}`);
    }
    return {
      capability: item.capability,
      risk: item.risk,
      targetKind: item.targetKind,
      targetFingerprint: item.routeRevision,
    };
  });
  const result = await db.$transaction(async (tx) => {
    const grants = await replaceCapabilityGrantsInTransaction({
      taskId: input.taskId,
      durationMinutes,
      maxUses: maxCapabilityJobs,
      targets,
    }, tx);
    const runtime = await applyUnattendedGoalLifecycleEventInTransaction(tx, {
      taskId: input.taskId,
      event: "ACTIVATED",
      refreshActive: true,
      policy: {
        maxDurationMs: durationMinutes * 60_000,
        maxCapabilityJobs,
      },
    });
    return {
      active: true,
      runtime,
      ownerMessageGrant: grants.find((grant) => grant.capability === OWNER_MESSAGE_CAPABILITY)!,
      capabilityGrants: grants,
    };
  });
  setUnattendedSignal(input.taskId, true);
  return result;
}

export async function disableUnattendedGoalFromUi(taskId: string) {
  const result = await db.$transaction(async (tx) => {
    const revoked = await revokeCapabilityGrantsInTransaction(taskId, tx);
    const runtime = await applyUnattendedGoalLifecycleEventInTransaction(tx, {
      taskId,
      event: "DEACTIVATED",
    });
    return { active: false, revoked, runtime };
  });
  setUnattendedSignal(taskId, false);
  return result;
}
