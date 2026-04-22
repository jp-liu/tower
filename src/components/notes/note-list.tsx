"use client";

import { FileText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
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
      <EmptyState icon={FileText} title={t("notes.empty")} description={t("notes.emptyHint")} />
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
