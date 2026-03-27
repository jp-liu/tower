// src/lib/fts.ts — NO Next.js imports
// FTS5 search helper and sync functions for notes_fts virtual table.
// Accepts PrismaClient as a parameter (dependency injection) so it is safe
// for both Next.js server actions and MCP stdio processes.
import type { PrismaClient } from "@prisma/client";

export interface FtsNoteResult {
  note_id: string;
  title: string;
  content: string;
}

/**
 * Search notes for a project using FTS5 (3+ chars) or LIKE fallback (< 3 chars).
 * Returns an empty array for blank queries.
 */
export async function searchNotes(
  db: PrismaClient,
  projectId: string,
  query: string
): Promise<FtsNoteResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (trimmed.length < 3) {
    // Fallback: LIKE search on the regular note table (FTS5 trigram needs 3+ chars)
    return db.$queryRawUnsafe<FtsNoteResult[]>(
      `SELECT id as note_id, title, content FROM "ProjectNote"
       WHERE "projectId" = ? AND (title LIKE ? OR content LIKE ?)
       LIMIT 20`,
      projectId,
      `%${trimmed}%`,
      `%${trimmed}%`
    );
  }

  // FTS5 trigram search (3+ chars)
  return db.$queryRawUnsafe<FtsNoteResult[]>(
    `SELECT f.note_id, f.title, f.content
     FROM notes_fts f
     JOIN "ProjectNote" n ON n.id = f.note_id
     WHERE f.notes_fts MATCH ? AND n."projectId" = ?
     ORDER BY rank
     LIMIT 20`,
    trimmed,
    projectId
  );
}

/**
 * Insert or replace a note in the notes_fts virtual table.
 * Performs delete-then-insert to avoid duplicate FTS rows on update.
 */
export async function syncNoteToFts(
  db: PrismaClient,
  note: { id: string; title: string; content: string }
): Promise<void> {
  // Delete existing entry if any, then insert fresh
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

/**
 * Remove a note from the notes_fts virtual table.
 * Safe to call even if the note was never indexed.
 */
export async function deleteNoteFromFts(
  db: PrismaClient,
  noteId: string
): Promise<void> {
  await db.$executeRawUnsafe(
    "DELETE FROM notes_fts WHERE note_id = ?",
    noteId
  );
}
