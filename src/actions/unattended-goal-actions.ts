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
import { recoverUnattendedGoalFinalNotification } from "@/lib/unattended-goal/final-notification";

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
}) {
  const discovery = await discoverGatewayCapabilities(input.taskId);
  const owner = discovery.capabilities.find((item) => item.capability === OWNER_MESSAGE_CAPABILITY);
  if (!owner?.available || !owner.routeRevision) {
    throw new Error("A fixed unattended OWNER home route is required before enabling unattended mode");
  }
  const ownerRouteRevision = owner.routeRevision;
  const durationMinutes = Math.trunc(input.durationMinutes ?? 480);
  const result = await db.$transaction(async (tx) => {
    const grants = await replaceCapabilityGrantsInTransaction({
      taskId: input.taskId,
      durationMinutes,
      targets: [{
        capability: OWNER_MESSAGE_CAPABILITY,
        risk: owner.risk,
        targetKind: owner.targetKind,
        targetFingerprint: ownerRouteRevision,
      }],
    }, tx);
    const runtime = await applyUnattendedGoalLifecycleEventInTransaction(tx, {
      taskId: input.taskId,
      event: "ACTIVATED",
      refreshActive: true,
      policy: {
        maxDurationMs: durationMinutes * 60_000,
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

export async function recoverUnattendedGoalNotificationFromUi(input: {
  taskId: string;
  durationMinutes?: number;
}) {
  const [discovery, mode] = await Promise.all([
    discoverGatewayCapabilities(input.taskId),
    readUnattendedGoalMode(db, input.taskId),
  ]);
  const owner = discovery.capabilities.find((item) => item.capability === OWNER_MESSAGE_CAPABILITY);
  if (!owner?.available || !owner.routeRevision) {
    throw new Error("A fixed unattended OWNER home route is required before recovering the final notification");
  }
  if (!mode.runtime?.ownerNotificationRequestId || !mode.runtime.ownerNotificationKind) {
    throw new Error("No recoverable unattended final notification exists");
  }
  if (mode.runtime.ownerNotificationState === "SIDE_EFFECT_UNKNOWN") {
    throw new Error("This notification may already have been sent and requires manual reconciliation");
  }
  const [grant] = await db.$transaction((tx) => replaceCapabilityGrantsInTransaction({
    taskId: input.taskId,
    durationMinutes: Math.trunc(input.durationMinutes ?? 120),
    targets: [{
      capability: OWNER_MESSAGE_CAPABILITY,
      risk: owner.risk,
      targetKind: owner.targetKind,
      targetFingerprint: owner.routeRevision!,
    }],
  }, tx));
  const notification = await recoverUnattendedGoalFinalNotification(input.taskId, db, true);
  return { active: false, ownerMessageGrant: grant, notification };
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
