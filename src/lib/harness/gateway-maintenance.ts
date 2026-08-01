import "server-only";

import { db } from "@/lib/db";

export const GATEWAY_SETTLED_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

interface RawStateMetric {
  state: string;
  rows: bigint | number;
  textBytes: bigint | number;
}

interface RawEligibleMetric {
  rows: bigint | number;
  textBytes: bigint | number;
}

interface OperationalStateMetric {
  rows: number;
  textBytes: number;
}

export interface GatewayEntityMeasurement {
  scanned: number;
  totalTextBytes: number;
  eligibleRows: number;
  eligibleTextBytes: number;
  byState: Record<string, OperationalStateMetric>;
}

export interface GatewayOperationalMeasurement {
  scanned: number;
  totalTextBytes: number;
  eligibleRows: number;
  eligibleTextBytes: number;
  inbound: GatewayEntityMeasurement;
  delivery: GatewayEntityMeasurement;
}

function asNumber(value: bigint | number | undefined): number {
  return Number(value ?? 0);
}

function entityMeasurement(
  states: RawStateMetric[],
  eligible: RawEligibleMetric | undefined,
): GatewayEntityMeasurement {
  return {
    scanned: states.reduce((sum, row) => sum + asNumber(row.rows), 0),
    totalTextBytes: states.reduce((sum, row) => sum + asNumber(row.textBytes), 0),
    eligibleRows: asNumber(eligible?.rows),
    eligibleTextBytes: asNumber(eligible?.textBytes),
    byState: Object.fromEntries(states.map((row) => [row.state, {
      rows: asNumber(row.rows),
      textBytes: asNumber(row.textBytes),
    }])),
  };
}

export async function measureGatewayOperationalData(
  now = new Date(),
): Promise<GatewayOperationalMeasurement> {
  const cutoff = new Date(now.getTime() - GATEWAY_SETTLED_RETENTION_MS);
  const [inboundStates, deliveryStates, eligibleInbounds, eligibleDeliveries] = await Promise.all([
    db.$queryRawUnsafe<RawStateMetric[]>(`
      SELECT "state", COUNT(*) AS "rows",
             COALESCE(SUM(
               length(CAST("content" AS BLOB)) +
               length(CAST(COALESCE("response", '') AS BLOB)) +
               length(CAST(COALESCE("lastError", '') AS BLOB))
             ), 0) AS "textBytes"
      FROM "GatewayInbound"
      GROUP BY "state"
    `),
    db.$queryRawUnsafe<RawStateMetric[]>(`
      SELECT "state", COUNT(*) AS "rows",
             COALESCE(SUM(
               length(CAST("content" AS BLOB)) +
               length(CAST(COALESCE("presentation", '') AS BLOB)) +
               length(CAST(COALESCE("lastError", '') AS BLOB))
             ), 0) AS "textBytes"
      FROM "GatewayDelivery"
      GROUP BY "state"
    `),
    db.$queryRawUnsafe<RawEligibleMetric[]>(`
      SELECT COUNT(*) AS "rows",
             COALESCE(SUM(
               length(CAST(i."content" AS BLOB)) +
               length(CAST(COALESCE(i."response", '') AS BLOB)) +
               length(CAST(COALESCE(i."lastError", '') AS BLOB))
             ), 0) AS "textBytes"
      FROM "GatewayInbound" i
      WHERE i."state" = 'PROCESSED'
        AND i."processedAt" < ?
        AND NOT EXISTS (
          SELECT 1 FROM "GatewayDelivery" d
          WHERE d."inboundId" = i."id" AND d."state" <> 'DELIVERED'
        )
    `, cutoff),
    db.$queryRawUnsafe<RawEligibleMetric[]>(`
      SELECT COUNT(*) AS "rows",
             COALESCE(SUM(
               length(CAST(d."content" AS BLOB)) +
               length(CAST(COALESCE(d."presentation", '') AS BLOB)) +
               length(CAST(COALESCE(d."lastError", '') AS BLOB))
             ), 0) AS "textBytes"
      FROM "GatewayDelivery" d
      WHERE d."state" = 'DELIVERED'
        AND d."deliveredAt" < ?
        AND EXISTS (
          SELECT 1 FROM "GatewayInbound" i
          WHERE i."id" = d."inboundId" AND i."state" = 'PROCESSED'
        )
    `, cutoff),
  ]);
  const inbound = entityMeasurement(inboundStates, eligibleInbounds[0]);
  const delivery = entityMeasurement(deliveryStates, eligibleDeliveries[0]);
  return {
    scanned: inbound.scanned + delivery.scanned,
    totalTextBytes: inbound.totalTextBytes + delivery.totalTextBytes,
    eligibleRows: inbound.eligibleRows + delivery.eligibleRows,
    eligibleTextBytes: inbound.eligibleTextBytes + delivery.eligibleTextBytes,
    inbound,
    delivery,
  };
}
