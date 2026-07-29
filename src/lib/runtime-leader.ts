import "server-only";

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

const RUNTIME_LEASE_ID = "tower-runtime";
export const RUNTIME_LEASE_TTL_MS = 20_000;
export const RUNTIME_LEASE_HEARTBEAT_MS = 5_000;

const leaderGlobal = globalThis as typeof globalThis & {
  __towerRuntimeOwnerId?: string;
};

export interface TowerRuntimeLeaseSnapshot {
  ownerId: string;
  pid: number;
  port: number | null;
  generation: number;
  expiresAt: Date;
}

export function towerRuntimeOwnerId(): string {
  if (!leaderGlobal.__towerRuntimeOwnerId) {
    leaderGlobal.__towerRuntimeOwnerId = `${process.pid}:${randomUUID()}`;
  }
  return leaderGlobal.__towerRuntimeOwnerId;
}

function runtimePort(): number | null {
  const parsed = Number.parseInt(process.env.PORT || "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : null;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(
      error && typeof error === "object" && "code" in error
      && (error as { code?: string }).code === "EPERM",
    );
  }
}

export async function acquireTowerRuntimeLease(
  ownerId = towerRuntimeOwnerId(),
  now = new Date(),
): Promise<TowerRuntimeLeaseSnapshot> {
  const expiresAt = new Date(now.getTime() + RUNTIME_LEASE_TTL_MS);
  try {
    await db.towerRuntimeLease.create({
      data: {
        id: RUNTIME_LEASE_ID,
        ownerId,
        pid: process.pid,
        port: runtimePort(),
        expiresAt,
        lastHeartbeatAt: now,
      },
    });
  } catch (error) {
    const unique = typeof error === "object" && error !== null && "code" in error
      && (error as { code?: string }).code === "P2002";
    if (!unique) throw error;
    const claimed = await db.towerRuntimeLease.updateMany({
      where: {
        id: RUNTIME_LEASE_ID,
        OR: [{ ownerId }, { expiresAt: { lt: now } }],
      },
      data: {
        ownerId,
        pid: process.pid,
        port: runtimePort(),
        generation: { increment: 1 },
        expiresAt,
        lastHeartbeatAt: now,
      },
    });
    if (claimed.count !== 1) {
      const current = await db.towerRuntimeLease.findUniqueOrThrow({
        where: { id: RUNTIME_LEASE_ID },
      });
      if (!processIsAlive(current.pid)) {
        const abandoned = await db.towerRuntimeLease.updateMany({
          where: {
            id: RUNTIME_LEASE_ID,
            ownerId: current.ownerId,
            generation: current.generation,
          },
          data: {
            ownerId,
            pid: process.pid,
            port: runtimePort(),
            generation: { increment: 1 },
            expiresAt,
            lastHeartbeatAt: now,
          },
        });
        if (abandoned.count === 1) {
          const lease = await db.towerRuntimeLease.findUniqueOrThrow({ where: { id: RUNTIME_LEASE_ID } });
          return {
            ownerId: lease.ownerId,
            pid: lease.pid,
            port: lease.port,
            generation: lease.generation,
            expiresAt: lease.expiresAt,
          };
        }
      }
      throw new Error(
        `Tower data directory is already owned by runtime pid=${current.pid}` +
        `${current.port ? ` port=${current.port}` : ""} until ${current.expiresAt.toISOString()}`,
      );
    }
  }
  const lease = await db.towerRuntimeLease.findUniqueOrThrow({ where: { id: RUNTIME_LEASE_ID } });
  return {
    ownerId: lease.ownerId,
    pid: lease.pid,
    port: lease.port,
    generation: lease.generation,
    expiresAt: lease.expiresAt,
  };
}

export async function heartbeatTowerRuntimeLease(
  ownerId = towerRuntimeOwnerId(),
  now = new Date(),
): Promise<boolean> {
  const updated = await db.towerRuntimeLease.updateMany({
    where: { id: RUNTIME_LEASE_ID, ownerId },
    data: {
      expiresAt: new Date(now.getTime() + RUNTIME_LEASE_TTL_MS),
      lastHeartbeatAt: now,
      pid: process.pid,
      port: runtimePort(),
    },
  });
  return updated.count === 1;
}

export async function releaseTowerRuntimeLease(
  ownerId = towerRuntimeOwnerId(),
): Promise<boolean> {
  const released = await db.towerRuntimeLease.deleteMany({
    where: { id: RUNTIME_LEASE_ID, ownerId },
  });
  return released.count === 1;
}
