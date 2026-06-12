"use client";

import { Streamdown } from "streamdown";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";

interface NotePreviewNote {
  title: string;
  content: string;
}

interface NotePreviewDialogProps {
  note: NotePreviewNote | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NotePreviewDialog({ note, open, onOpenChange }: NotePreviewDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(960px,92vw)] max-w-none sm:max-w-none h-[85vh] max-h-[85vh] flex flex-col p-0 gap-0">
        <h3 className="text-sm font-medium truncate px-5 py-3 border-b border-border/50">
          {note?.title}
        </h3>
        <div className="flex-1 overflow-auto px-5 py-4">
          {note && note.content.trim() ? (
            <div className="text-sm leading-relaxed">
              <Streamdown>{note.content}</Streamdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("taskPage.noteEmpty")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
