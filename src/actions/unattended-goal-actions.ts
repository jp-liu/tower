"use server";

import { db } from "@/lib/db";
import {
  activateUnattendedGoal,
  endUnattendedGoal,
  readUnattendedGoalMode,
} from "@/lib/unattended-goal/runtime";
import {
  issueCapabilityGrants,
  revokeCapabilityGrants,
} from "@/lib/gateway/capability-grants";
import { discoverGatewayCapabilities } from "@/lib/gateway/capability-runtime";
import { OWNER_MESSAGE_CAPABILITY } from "@/lib/gateway/capability-contract";

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
  const grants = await issueCapabilityGrants({
    taskId: input.taskId,
    durationMinutes: input.durationMinutes,
    maxUses: input.maxUses,
    targets: authorized.map((item) => {
      if (!item.available || !item.routeRevision) {
        throw new Error(`Capability is unavailable: ${item.capability}`);
      }
      return {
        capability: item.capability,
        risk: item.risk,
        targetKind: item.targetKind,
        targetFingerprint: item.routeRevision,
      };
    }),
  });
  try {
    const durationMinutes = Math.max(5, Math.min(Math.trunc(input.durationMinutes ?? 480), 7 * 24 * 60));
    const maxCapabilityJobs = Math.max(1, Math.min(Math.trunc(input.maxUses ?? 20), 1_000));
    const runtime = await activateUnattendedGoal(db, input.taskId, {
      maxDurationMs: durationMinutes * 60_000,
      maxCapabilityJobs,
    });
    return {
      active: true,
      runtime,
      ownerMessageGrant: grants.find((grant) => grant.capability === OWNER_MESSAGE_CAPABILITY)!,
      capabilityGrants: grants,
    };
  } catch (error) {
    await revokeCapabilityGrants(input.taskId).catch(() => undefined);
    throw error;
  }
}

export async function disableUnattendedGoalFromUi(taskId: string) {
  const [revoked, runtime] = await Promise.all([
    revokeCapabilityGrants(taskId),
    endUnattendedGoal(db, taskId, "DEACTIVATED"),
  ]);
  return { active: false, revoked, runtime };
}
