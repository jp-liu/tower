"use client";

import { Pencil, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/lib/i18n";

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  category: string;
  updatedAt: Date;
}

interface NoteCardProps {
  note: NoteItem;
  onEdit: (note: NoteItem) => void;
  onDelete: (noteId: string) => void;
}

export function NoteCard({ note, onEdit, onDelete }: NoteCardProps) {
  const { t } = useI18n();
  const contentPreview = note.content.slice(0, 300);

  return (
    <div className="group relative rounded-lg border border-border bg-card p-4 transition-colors hover:border-border/80 hover:bg-accent/20">
      {/* Action buttons */}
      <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => onEdit(note)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("notes.edit")}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onDelete(note.id)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-rose-400"
          aria-label={t("notes.delete")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Title */}
      <div className="mb-2 pr-16">
        <h3 className="truncate text-sm font-semibold text-foreground">{note.title}</h3>
      </div>

      {/* Category badge */}
      <span className="mb-3 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        {note.category}
      </span>

      {/* Content preview */}
      <div className="prose prose-sm dark:prose-invert max-h-24 overflow-hidden text-muted-foreground">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{contentPreview}</ReactMarkdown>
      </div>
    </div>
  );
}
