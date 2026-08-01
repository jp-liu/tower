import "server-only";

import { db } from "@/lib/db";

export const WORKBENCH_RESOLVED_RETENTION_MS = 24 * 60 * 60 * 1_000;

interface RawStateMetric {
  state: string;
  rows: bigint | number;
  textBytes: bigint | number;
}

interface RawEligibleMetric {
  rows: bigint | number;
  textBytes: bigint | number;
}

export interface OperationalStateMetric {
  rows: number;
  textBytes: number;
}

export interface WorkbenchOperationalMeasurement {
  scanned: number;
  totalTextBytes: number;
  eligibleRows: number;
  eligibleTextBytes: number;
  byState: Record<string, OperationalStateMetric>;
}

function asNumber(value: bigint | number | undefined): number {
  return Number(value ?? 0);
}

export async function measureWorkbenchOperationalData(
  now = new Date(),
): Promise<WorkbenchOperationalMeasurement> {
  const cutoff = new Date(now.getTime() - WORKBENCH_RESOLVED_RETENTION_MS);
  const [states, eligible] = await Promise.all([
    db.$queryRawUnsafe<RawStateMetric[]>(`
      SELECT "state",
             COUNT(*) AS "rows",
             COALESCE(SUM(length(CAST("prompt" AS BLOB))), 0) AS "textBytes"
      FROM "WorkbenchBatch"
      GROUP BY "state"
    `),
    db.$queryRawUnsafe<RawEligibleMetric[]>(`
      SELECT COUNT(*) AS "rows",
             COALESCE(SUM(length(CAST("prompt" AS BLOB))), 0) AS "textBytes"
      FROM "WorkbenchBatch"
      WHERE "state" = 'RESOLVED'
        AND "resolvedAt" < ?
    `, cutoff),
  ]);
  const byState = Object.fromEntries(states.map((row) => [row.state, {
    rows: asNumber(row.rows),
    textBytes: asNumber(row.textBytes),
  }]));
  return {
    scanned: states.reduce((sum, row) => sum + asNumber(row.rows), 0),
    totalTextBytes: states.reduce((sum, row) => sum + asNumber(row.textBytes), 0),
    eligibleRows: asNumber(eligible[0]?.rows),
    eligibleTextBytes: asNumber(eligible[0]?.textBytes),
    byState,
  };
}
