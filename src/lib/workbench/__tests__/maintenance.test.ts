import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { measureWorkbenchOperationalData } from "../maintenance";

const NOW = new Date("2026-08-01T00:00:00.000Z");
const OLD = new Date("2026-07-29T00:00:00.000Z");
const YOUNG = new Date("2026-07-31T12:00:00.000Z");

let workspaceId: string;
let parentTaskId: string;
let sourceTaskId: string;

async function createBatch(input: {
  id: string;
  state: "CLAIMED" | "FAILED" | "RESOLVED";
  prompt: string;
  resolvedAt?: Date;
}) {
  return db.workbenchBatch.create({
    data: {
      id: input.id,
      parentTaskId,
      eventIds: "[]",
      prompt: input.prompt,
      state: input.state,
      resolvedAt: input.resolvedAt,
    },
  });
}

beforeEach(async () => {
  const workspace = await db.workspace.create({
    data: { name: `workbench-maintenance-${randomUUID()}` },
  });
  workspaceId = workspace.id;
  const project = await db.project.create({
    data: { name: "Maintenance", workspaceId },
  });
  const [parent, source] = await Promise.all([
    db.task.create({ data: { title: "Parent", projectId: project.id } }),
    db.task.create({ data: { title: "Source", projectId: project.id, status: "DONE" } }),
  ]);
  parentTaskId = parent.id;
  sourceTaskId = source.id;
});

afterEach(async () => {
  await db.workspace.delete({ where: { id: workspaceId } });
});

describe("Workbench operational observation", () => {
  it("measures old resolved prompt bytes without mutating batches or replay events", async () => {
    const old = await createBatch({
      id: `wb-old-${randomUUID()}`,
      state: "RESOLVED",
      prompt: "old prompt with unicode 内容",
      resolvedAt: OLD,
    });
    await createBatch({
      id: `wb-young-${randomUUID()}`,
      state: "RESOLVED",
      prompt: "young prompt",
      resolvedAt: YOUNG,
    });
    await createBatch({ id: `wb-active-${randomUUID()}`, state: "CLAIMED", prompt: "active prompt" });
    await createBatch({ id: `wb-failed-${randomUUID()}`, state: "FAILED", prompt: "failed prompt" });
    const event = await db.workbenchEvent.create({
      data: {
        parentTaskId,
        sourceTaskId,
        kind: "CHILD_REVIEW_REQUIRED",
        dedupKey: `maintenance-event-${randomUUID()}`,
        batchId: old.id,
        payload: JSON.stringify({ secret: "replay me later" }),
        state: "CONSUMED",
        consumedAt: OLD,
      },
    });

    const measured = await measureWorkbenchOperationalData(NOW);
    expect(measured.eligibleRows).toBe(1);
    expect(measured.eligibleTextBytes).toBe(Buffer.byteLength("old prompt with unicode 内容"));
    expect(measured.byState).toMatchObject({
      CLAIMED: { rows: 1 },
      FAILED: { rows: 1 },
      RESOLVED: { rows: 2 },
    });
    expect((await db.workbenchBatch.findUniqueOrThrow({ where: { id: old.id } })).prompt)
      .toBe("old prompt with unicode 内容");
    expect(await db.workbenchEvent.findUniqueOrThrow({ where: { id: event.id } }))
      .toMatchObject({ state: "CONSUMED", payload: JSON.stringify({ secret: "replay me later" }) });

    await db.task.update({ where: { id: sourceTaskId }, data: { status: "IN_PROGRESS" } });
    expect((await db.workbenchEvent.findUniqueOrThrow({ where: { id: event.id } })).payload)
      .toBe(JSON.stringify({ secret: "replay me later" }));
  });
});
