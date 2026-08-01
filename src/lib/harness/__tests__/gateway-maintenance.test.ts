import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { measureGatewayOperationalData } from "../gateway-maintenance";

const NOW = new Date("2026-08-01T00:00:00.000Z");
const OLD = new Date("2026-07-20T00:00:00.000Z");
const YOUNG = new Date("2026-07-30T00:00:00.000Z");

let workspaceId: string;
let sessionId: string;
const gateway = `maintenance-${randomUUID()}`;

async function createInbound(input: {
  state: "QUEUED" | "PROCESSING" | "PROCESSED" | "FAILED";
  content?: string;
  processedAt?: Date;
}) {
  return db.gatewayInbound.create({
    data: {
      dedupKey: `inbound-${randomUUID()}`,
      sessionId,
      gateway,
      platform: "feishu",
      chatId: "maintenance-chat",
      platformMessageId: `message-${randomUUID()}`,
      intent: "PROJECT_WORK",
      content: input.content ?? "inbound secret 内容",
      response: "response secret",
      lastError: "old inbound error",
      state: input.state,
      processedAt: input.processedAt ?? OLD,
    },
  });
}

async function createDelivery(input: {
  inboundId: string;
  state: "PENDING" | "SENDING" | "DELIVERED" | "SENT_UNVERIFIED" | "FAILED";
  deliveredAt?: Date;
}) {
  return db.gatewayDelivery.create({
    data: {
      dedupKey: `delivery-${randomUUID()}`,
      sessionId,
      inboundId: input.inboundId,
      kind: "FINAL_RESULT",
      content: "delivery secret 内容",
      presentation: JSON.stringify({ body: "presentation secret" }),
      lastError: "old delivery error",
      state: input.state,
      deliveredAt: input.deliveredAt ?? OLD,
    },
  });
}

beforeEach(async () => {
  const workspace = await db.workspace.create({
    data: { name: `gateway-maintenance-${randomUUID()}` },
  });
  workspaceId = workspace.id;
  const project = await db.project.create({ data: { name: "Gateway maintenance", workspaceId } });
  const session = await db.gatewaySession.create({
    data: {
      bindingKey: `maintenance-binding-${randomUUID()}`,
      gateway,
      platform: "feishu",
      chatId: "maintenance-chat",
      kind: "WORKBENCH",
      projectId: project.id,
    },
  });
  sessionId = session.id;
});

afterEach(async () => {
  await db.gatewayDelivery.deleteMany({ where: { sessionId } });
  await db.gatewayInbound.deleteMany({ where: { gateway } });
  await db.workspace.delete({ where: { id: workspaceId } });
});

describe("Gateway operational observation", () => {
  it("measures only rows satisfying the terminal state and relation predicates", async () => {
    const baseline = await measureGatewayOperationalData(NOW);
    const settledInbound = await createInbound({ state: "PROCESSED" });
    await createDelivery({ inboundId: settledInbound.id, state: "DELIVERED" });
    const pendingInbound = await createInbound({ state: "PROCESSED", content: "keep pending inbound" });
    await createDelivery({ inboundId: pendingInbound.id, state: "PENDING" });
    const queuedInbound = await createInbound({ state: "QUEUED", content: "keep queued inbound" });
    await createDelivery({ inboundId: queuedInbound.id, state: "DELIVERED" });
    const uncertainInbound = await createInbound({ state: "PROCESSED", content: "keep uncertain inbound" });
    await createDelivery({ inboundId: uncertainInbound.id, state: "SENT_UNVERIFIED" });
    await createInbound({ state: "FAILED", content: "keep failed inbound" });
    const youngInbound = await createInbound({ state: "PROCESSED", processedAt: YOUNG });
    await createDelivery({ inboundId: youngInbound.id, state: "DELIVERED", deliveredAt: YOUNG });

    const measured = await measureGatewayOperationalData(NOW);
    expect(measured.inbound.eligibleRows - baseline.inbound.eligibleRows).toBe(1);
    expect(measured.delivery.eligibleRows - baseline.delivery.eligibleRows).toBe(1);
    expect(measured.inbound.byState.FAILED!.rows - (baseline.inbound.byState.FAILED?.rows ?? 0)).toBe(1);
    expect(measured.inbound.byState.PROCESSED!.rows - (baseline.inbound.byState.PROCESSED?.rows ?? 0)).toBe(4);
    expect(measured.inbound.byState.QUEUED!.rows - (baseline.inbound.byState.QUEUED?.rows ?? 0)).toBe(1);
    expect(measured.delivery.byState.DELIVERED!.rows - (baseline.delivery.byState.DELIVERED?.rows ?? 0)).toBe(3);
    expect(measured.delivery.byState.PENDING!.rows - (baseline.delivery.byState.PENDING?.rows ?? 0)).toBe(1);
    expect(measured.delivery.byState.SENT_UNVERIFIED!.rows
      - (baseline.delivery.byState.SENT_UNVERIFIED?.rows ?? 0)).toBe(1);
    expect((await db.gatewayInbound.findUniqueOrThrow({ where: { id: settledInbound.id } })).content)
      .toBe("inbound secret 内容");

    await db.gatewayInbound.update({ where: { id: queuedInbound.id }, data: { state: "PROCESSED" } });
    const afterSettlement = await measureGatewayOperationalData(NOW);
    expect(afterSettlement.inbound.eligibleRows - baseline.inbound.eligibleRows).toBe(2);
    expect(afterSettlement.delivery.eligibleRows - baseline.delivery.eligibleRows).toBe(2);
  });
});
