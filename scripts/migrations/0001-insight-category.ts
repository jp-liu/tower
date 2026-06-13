/**
 * Rename legacy session-insight ("dreaming") note categories to the current
 * label. Covers the original "session-insight" slug and the short-lived
 * "会话洞见" interim value → "经验洞见".
 *
 * Idempotent. Values are hardcoded on purpose: a migration is a point-in-time
 * snapshot and must NOT import live app constants (those can change later; this
 * migration must keep doing exactly what it did the day it shipped). src/ is
 * also absent from the published package.
 */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  const res = await prisma.projectNote.updateMany({
    where: { category: { in: ["session-insight", "会话洞见"] } },
    data: { category: "经验洞见" },
  });
  if (res.count > 0) {
    console.log(`  renamed ${res.count} insight note(s) → 经验洞见`);
  }
}
