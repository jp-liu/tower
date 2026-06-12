"use client";

import { Pencil, Trash2, Link2 } from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  category: string;
  updatedAt: Date;
  taskId?: string | null;
  taskTitle?: string | null;
}

interface NoteCardProps {
  note: NoteItem;
  onEdit: (note: NoteItem) => void;
  onDelete: (noteId: string) => void;
  /** Open the full-content preview dialog. */
  onPreview?: (note: NoteItem) => void;
  /** Open the linked task's overview drawer (when the note is task-bound). */
  onTaskClick?: (taskId: string) => void;
}

export function NoteCard({ note, onEdit, onDelete, onPreview, onTaskClick }: NoteCardProps) {
  const { t } = useI18n();
  // Preview body is intentionally clipped — the card stays compact. The full,
  // untruncated content is reachable by clicking the card (opens the preview
  // dialog), so long auto-generated notes are no longer "lost" behind the clip.
  const contentPreview = note.content.slice(0, 300);

  return (
    <div className="group relative rounded-lg border border-border bg-card p-4 transition-colors hover:border-border/80 hover:bg-accent/20">
      {/* Action buttons */}
      <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onEdit(note)}
          className="text-muted-foreground"
          aria-label={t("notes.edit")}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onDelete(note.id)}
          className="text-muted-foreground hover:text-rose-400"
          aria-label={t("notes.delete")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Title */}
      <div className="mb-2 pr-16">
        <h3 className="truncate text-sm font-semibold text-foreground">{note.title}</h3>
      </div>

      {/* Badges: category + (optional) linked task */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {note.category}
        </span>
        {note.taskId && note.taskTitle && (
          <button
            type="button"
            onClick={() => note.taskId && onTaskClick?.(note.taskId)}
            disabled={!onTaskClick}
            className={`inline-flex max-w-[160px] items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary ${onTaskClick ? "cursor-pointer hover:bg-primary/15" : "cursor-default"}`}
            title={note.taskTitle}
          >
            <Link2 className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{note.taskTitle}</span>
          </button>
        )}
      </div>

      {/* Content preview — click to open the full-content dialog */}
      <button
        type="button"
        onClick={() => onPreview?.(note)}
        disabled={!onPreview}
        className={`block w-full text-left ${onPreview ? "cursor-pointer" : "cursor-default"}`}
        title={onPreview ? t("notes.previewNote") : undefined}
      >
        <div className="max-h-24 overflow-hidden text-sm leading-relaxed text-muted-foreground">
          <Streamdown>{contentPreview}</Streamdown>
        </div>
      </button>
    </div>
  );
}
