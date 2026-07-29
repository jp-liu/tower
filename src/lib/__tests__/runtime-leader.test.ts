import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  acquireTowerRuntimeLease,
  heartbeatTowerRuntimeLease,
  releaseTowerRuntimeLease,
  RUNTIME_LEASE_TTL_MS,
} from "@/lib/runtime-leader";

beforeEach(async () => {
  await db.towerRuntimeLease.deleteMany();
});

describe("Tower database runtime leader lease", () => {
  it("rejects a second live owner for the same data directory", async () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    await expect(acquireTowerRuntimeLease("runtime-a", now)).resolves.toMatchObject({
      ownerId: "runtime-a",
      generation: 1,
    });
    await expect(acquireTowerRuntimeLease("runtime-b", new Date(now.getTime() + 1_000)))
      .rejects.toThrow("already owned");
  });

  it("fences the old owner after lease expiry and takeover", async () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    await acquireTowerRuntimeLease("runtime-a", now);
    const takeover = await acquireTowerRuntimeLease(
      "runtime-b",
      new Date(now.getTime() + RUNTIME_LEASE_TTL_MS + 1),
    );
    expect(takeover).toMatchObject({ ownerId: "runtime-b", generation: 2 });
    await expect(heartbeatTowerRuntimeLease("runtime-a", new Date(now.getTime() + RUNTIME_LEASE_TTL_MS + 2)))
      .resolves.toBe(false);
    await expect(heartbeatTowerRuntimeLease("runtime-b", new Date(now.getTime() + RUNTIME_LEASE_TTL_MS + 2)))
      .resolves.toBe(true);
    await expect(releaseTowerRuntimeLease("runtime-b")).resolves.toBe(true);
  });
});
