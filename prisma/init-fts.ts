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
  console.log("FTS5 virtual table 'notes_fts' initialized successfully");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("FTS5 init failed:", e);
  process.exit(1);
});
