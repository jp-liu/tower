/**
 * One-off cleanup for duplicate ProjectAsset rows produced by the old
 * auto-upload hook, which appended a `-<Date.now()>` (13-digit epoch-ms) suffix
 * on every re-edit of the same file.
 *
 * Groups assets by (projectId, logical filename) where the logical filename is
 * the stored filename with a trailing `-<13-digit-epoch>` stripped. Within each
 * group it keeps the NEWEST asset (latest content) and removes the older
 * duplicates — both the DB row and the on-disk file.
 *
 * DRY-RUN BY DEFAULT. Pass `--apply` to actually delete.
 *
 *   pnpm tsx scripts/dedup-existing-assets.ts          # report only
 *   pnpm tsx scripts/dedup-existing-assets.ts --apply  # delete duplicates
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";

const db = new PrismaClient();

// `-<13-digit epoch starting with 1>` right before the extension (or at end).
// Date.now() in 2025-2026 is ~1.7e12 → 13 digits beginning with "1".
const TIMESTAMP_SUFFIX_RE = /-(1\d{12})(\.[^.]+)?$/;

function logicalName(filename: string): string {
  return filename.replace(TIMESTAMP_SUFFIX_RE, "$2");
}

async function main() {
  const apply = process.argv.includes("--apply");
  await db.$connect();

  const assets = await db.projectAsset.findMany({
    select: { id: true, projectId: true, filename: true, path: true, size: true, createdAt: true },
    orderBy: { createdAt: "desc" }, // newest first within each group
  });

  const groups = new Map<string, typeof assets>();
  for (const a of assets) {
    const key = `${a.projectId}::${logicalName(a.filename)}`;
    const arr = groups.get(key);
    if (arr) arr.push(a);
    else groups.set(key, [a]);
  }

  const toDelete: { id: string; filename: string; path: string }[] = [];
  const keptPaths = new Set<string>();
  let dupGroups = 0;
  for (const [key, arr] of groups) {
    keptPaths.add(arr[0].path); // newest is always kept
    if (arr.length < 2) continue;
    dupGroups++;
    const [keep, ...rest] = arr; // arr is newest-first → keep[0]
    console.log(
      `\n• ${key.split("::")[1]}  (${arr.length} copies) → keep "${keep.filename}", drop ${rest.length}`
    );
    for (const r of rest) toDelete.push({ id: r.id, filename: r.filename, path: r.path });
  }

  console.log(
    `\n${"=".repeat(60)}\n` +
      `Assets total:        ${assets.length}\n` +
      `Duplicate groups:    ${dupGroups}\n` +
      `Rows to delete:      ${toDelete.length}\n` +
      `Rows kept:           ${assets.length - toDelete.length}\n` +
      `Mode:                ${apply ? "APPLY (deleting)" : "DRY-RUN (no changes)"}`
  );

  if (!apply) {
    console.log("\nRe-run with --apply to delete the duplicates above.");
    await db.$disconnect();
    return;
  }

  let filesRemoved = 0;
  let filesMissing = 0;
  for (const d of toDelete) {
    // Never unlink a file a kept asset still points to (race-created rows can
    // share one on-disk path with their kept sibling).
    if (keptPaths.has(d.path)) continue;
    try {
      fs.unlinkSync(d.path);
      filesRemoved++;
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") filesMissing++;
      else console.warn(`  ! failed to unlink ${d.path}: ${(err as Error).message}`);
    }
  }
  const ids = toDelete.map((d) => d.id);
  // Delete in chunks to keep the SQL parameter list small.
  let rowsRemoved = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const res = await db.projectAsset.deleteMany({ where: { id: { in: chunk } } });
    rowsRemoved += res.count;
  }

  console.log(
    `\nDeleted: ${rowsRemoved} rows, ${filesRemoved} files (${filesMissing} already missing).`
  );
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
