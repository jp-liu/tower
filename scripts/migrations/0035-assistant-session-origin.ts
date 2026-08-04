/**
 * Add AssistantSession.origin — mark where a session came from.
 *
 * Gateway (Feishu group PROJECT_DISCUSSION) reuses the assistant session
 * infrastructure, so its sessions leaked into the assistant list next to the
 * user's hand-opened ones. `origin` ("UI" | "GATEWAY") lets the list hide
 * gateway discussions by default while the API can still fetch them for triage.
 *
 * Additive raw SQL — never touches notes_fts (prisma db push hangs on it).
 * Idempotent: SQLite has no ADD COLUMN IF NOT EXISTS, so PRAGMA-check first.
 * Backfill via UPDATE is naturally idempotent (re-running sets the same value).
 *
 * Table/column names hardcoded on purpose — a migration is a point-in-time
 * snapshot and must keep doing exactly what it did the day it shipped.
 */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  const cols = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("AssistantSession")`
  );
  const hasCol = Array.isArray(cols) && cols.some((c) => c.name === "origin");
  if (!hasCol) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "AssistantSession" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'UI'`
    );
    console.log("  added AssistantSession.origin");
  }
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AssistantSession_origin_idx" ON "AssistantSession"("origin")`
  );
  // Backfill historical gateway discussions referenced by GatewaySession.
  await prisma.$executeRawUnsafe(
    `UPDATE "AssistantSession" SET "origin" = 'GATEWAY' WHERE "id" IN (` +
      `SELECT "assistantSessionId" FROM "GatewaySession" WHERE "assistantSessionId" IS NOT NULL)`
  );
}
