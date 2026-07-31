import "server-only";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { setWorkbenchDeliveryObserver } from "@/lib/workbench/delivery-lifecycle";

const log = logger.create("gateway-workbench-delivery");

type LegacyGatewayCommandPayload = {
  childTaskId?: string;
  childTitle?: string;
  instruction?: string;
  sourceReference?: { namespace?: string; id?: string };
  gatewayInboundId?: string;
  gatewayMessage?: string;
};

function parsePayload(payload: string): LegacyGatewayCommandPayload | null {
  try {
    return JSON.parse(payload) as LegacyGatewayCommandPayload;
  } catch {
    return null;
  }
}

function gatewayInboundId(payload: string): string | null {
  const value = parsePayload(payload);
  if (!value) return null;
  if (value.sourceReference?.namespace === "gateway_inbound") {
    return value.sourceReference.id?.trim() || null;
  }
  return value.gatewayInboundId?.trim() || null;
}

export async function migrateLegacyGatewayWorkbenchCommands(): Promise<number> {
  const commands = await db.workbenchEvent.findMany({
    where: {
      kind: "GATEWAY_WORK_REQUEST",
      state: { in: ["PENDING", "PROCESSING"] },
    },
    select: { id: true, payload: true },
  });
  let migrated = 0;
  for (const command of commands) {
    const payload = parsePayload(command.payload);
    const inboundId = payload?.gatewayInboundId?.trim();
    const instruction = payload?.gatewayMessage?.trim();
    if (!payload || payload.instruction || !inboundId || !instruction) continue;
    await db.workbenchEvent.update({
      where: { id: command.id },
      data: {
        payload: JSON.stringify({
          childTaskId: payload.childTaskId,
          childTitle: payload.childTitle,
          instruction,
          sourceReference: { namespace: "gateway_inbound", id: inboundId },
        }),
      },
    });
    migrated++;
  }
  return migrated;
}

export function registerGatewayWorkbenchDeliveryLifecycle(): void {
  setWorkbenchDeliveryObserver({
    async batchDispatched({ batchId, commands }) {
      const inboundIds = commands.flatMap((command) => {
        const id = gatewayInboundId(command.payload);
        return id ? [id] : [];
      });
      if (inboundIds.length === 0) return;
      await db.gatewayInbound.updateMany({
        where: { id: { in: inboundIds }, state: "QUEUED" },
        data: { state: "PROCESSING", lastError: null },
      }).catch((error) => {
        log.warn("Workbench batch dispatched but gateway inbound projection failed", {
          batchId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
  });
}
