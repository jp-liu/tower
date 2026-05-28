import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  await db.$connect();
  await db.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
    USING fts5(
      note_id UNINDEXED,
      title,
      content,
      tokenize='trigram case_sensitive 0'
    )
  `);

  // Repopulate from ProjectNote when the FTS index is empty but notes exist.
  // This is the case after `db push --accept-data-loss` drops the shadow
  // tables during schema migration — without this, search returns nothing
  // until users edit each note.
  const [{ count: ftsCount }] = await db.$queryRawUnsafe<[{ count: bigint }]>(
    "SELECT COUNT(*) as count FROM notes_fts"
  );
  const noteCount = await db.projectNote.count();

  if (Number(ftsCount) < noteCount) {
    const notes = await db.projectNote.findMany({
      select: { id: true, title: true, content: true },
    });
    for (const note of notes) {
      await db.$executeRawUnsafe(
        "DELETE FROM notes_fts WHERE note_id = ?",
        note.id
      );
      await db.$executeRawUnsafe(
        "INSERT INTO notes_fts(note_id, title, content) VALUES (?, ?, ?)",
        note.id,
        note.title,
        note.content
      );
    }
    console.log(`FTS5: repopulated ${notes.length} notes`);
  }

  console.log("FTS5 virtual table 'notes_fts' initialized successfully");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("FTS5 init failed:", e);
  process.exit(1);
});
