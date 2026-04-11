"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { syncNoteToFts, deleteNoteFromFts } from "@/lib/fts";

const createNoteSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string(),
  category: z.string().max(50).optional(),
  projectId: z.string().min(1),
  taskId: z.string().optional(),
});

const updateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  category: z.string().max(50).optional(),
});

export async function createNote(data: {
  title: string;
  content: string;
  category?: string;
  projectId: string;
  taskId?: string;
}) {
  const parsed = createNoteSchema.parse(data);
  const note = await db.projectNote.create({
    data: {
      title: parsed.title,
      content: parsed.content,
      category: parsed.category ?? "备忘",
      projectId: parsed.projectId,
      taskId: parsed.taskId ?? null,
    },
  });
  await syncNoteToFts(db, { id: note.id, title: note.title, content: note.content });
  revalidatePath(`/workspace`);
  return note;
}

export async function updateNote(
  noteId: string,
  data: { title?: string; content?: string; category?: string }
) {
  const parsed = updateNoteSchema.parse(data);
  const note = await db.projectNote.update({
    where: { id: noteId },
    data: parsed,
  });
  await syncNoteToFts(db, { id: note.id, title: note.title, content: note.content });
  revalidatePath(`/workspace`);
  return note;
}

export async function deleteNote(noteId: string) {
  await deleteNoteFromFts(db, noteId);
  await db.projectNote.delete({ where: { id: noteId } });
  revalidatePath(`/workspace`);
}

export async function getNoteById(noteId: string) {
  return db.projectNote.findUnique({ where: { id: noteId } });
}

export async function getProjectNotes(
  projectId: string,
  options?: { category?: string }
) {
  return db.projectNote.findMany({
    where: {
      projectId,
      taskId: null,
      ...(options?.category ? { category: options.category } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getTaskNotes(taskId: string) {
  return db.projectNote.findMany({
    where: { taskId },
    orderBy: { updatedAt: "desc" },
  });
}
