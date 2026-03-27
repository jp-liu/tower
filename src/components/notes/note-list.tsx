"use client";

import { useI18n } from "@/lib/i18n";
import { NoteCard, type NoteItem } from "./note-card";

interface NoteListProps {
  notes: NoteItem[];
  onEdit: (note: NoteItem) => void;
  onDelete: (noteId: string) => void;
}

export function NoteList({ notes, onEdit, onDelete }: NoteListProps) {
  const { t } = useI18n();

  if (notes.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium text-muted-foreground">{t("notes.empty")}</p>
        <p className="text-xs text-muted-foreground/60">{t("notes.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}
