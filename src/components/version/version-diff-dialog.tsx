"use client";

import { useState, useEffect, useTransition } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getVersionDiff } from "@/actions/version-actions";
import { parseUnifiedDiff } from "@/lib/git-diff";
import type { DiffFile } from "@/lib/git-diff";
import { useI18n } from "@/lib/i18n";

// Cap rendering at 500 lines per file to avoid freezing the page on huge patches
const MAX_LINES_PER_FILE = 500;

// ─── Per-file collapsible diff block ─────────────────────────────────────────

interface FileDiffBlockProps {
  file: DiffFile;
}

function FileDiffBlock({ file }: FileDiffBlockProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);

  const filename = file.to && file.to !== "/dev/null" ? file.to : (file.from ?? "");
  const additions = file.additions ?? 0;
  const deletions = file.deletions ?? 0;

  // Flatten all change lines across chunks
  const allLines: { type: "add" | "del" | "normal"; content: string; chunkHeader?: string }[] = [];
  for (const chunk of file.chunks) {
    allLines.push({ type: "normal", content: chunk.content, chunkHeader: chunk.content });
    for (const change of chunk.changes) {
      allLines.push({ type: change.type as "add" | "del" | "normal", content: change.content });
    }
  }

  const truncated = allLines.length > MAX_LINES_PER_FILE;
  const visibleLines = truncated ? allLines.slice(0, MAX_LINES_PER_FILE) : allLines;

  return (
    <div className="overflow-hidden rounded-[10px] border border-border">
      {/* File header / toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 flex-none text-muted-foreground/60 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        <span className="flex-1 truncate font-mono text-[12px] font-medium text-foreground">
          {filename}
        </span>
        <span className="shrink-0 font-mono text-[11px] font-bold text-emerald-400">
          +{additions}
        </span>
        <span className="shrink-0 font-mono text-[11px] font-bold text-rose-400">
          −{deletions}
        </span>
      </button>

      {/* Diff lines */}
      {open && (
        <div className="overflow-x-auto">
          <pre className="m-0 p-0">
            {visibleLines.map((line, i) => {
              if (line.chunkHeader !== undefined) {
                return (
                  <div
                    key={i}
                    className="whitespace-pre px-3 py-px font-mono text-xs text-muted-foreground bg-muted/40"
                  >
                    {line.content}
                  </div>
                );
              }
              if (line.type === "add") {
                return (
                  <div
                    key={i}
                    className="whitespace-pre px-3 py-px font-mono text-xs text-emerald-300 bg-emerald-500/10"
                  >
                    {line.content}
                  </div>
                );
              }
              if (line.type === "del") {
                return (
                  <div
                    key={i}
                    className="whitespace-pre px-3 py-px font-mono text-xs text-rose-300 bg-rose-500/10"
                  >
                    {line.content}
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className="whitespace-pre px-3 py-px font-mono text-xs text-muted-foreground"
                >
                  {line.content}
                </div>
              );
            })}
          </pre>
          {truncated && (
            <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground/70 italic">
              {t("version.diff.truncated")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

export interface VersionDiffDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  versionId: string | null;
  versionLabel?: string;
}

export function VersionDiffDialog(props: VersionDiffDialogProps) {
  const dialogKey = `${props.open ? "open" : "closed"}:${props.versionId ?? "none"}`;
  return <VersionDiffDialogState key={dialogKey} {...props} />;
}

function VersionDiffDialogState({
  open,
  onOpenChange,
  versionId,
  versionLabel,
}: VersionDiffDialogProps) {
  const { t } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!open || !versionId) return;
    startTransition(async () => {
      const result = await getVersionDiff(versionId);
      if (!result) {
        setEmpty(true);
        return;
      }
      const parsed = parseUnifiedDiff(result.patch);
      if (parsed.length === 0 || result.patch === "") {
        setEmpty(true);
      } else {
        setFiles(parsed);
      }
    });
  }, [open, versionId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            {t("version.diff.title")}
            {versionLabel ? ` — ${versionLabel}` : ""}
          </DialogTitle>
        </DialogHeader>

        {isPending && (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{t("version.diff.loading")}</span>
          </div>
        )}

        {!isPending && empty && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("version.diff.empty")}
          </p>
        )}

        {!isPending && files && files.length > 0 && (
          <div className="flex flex-col gap-2">
            {files.map((file, i) => (
              <FileDiffBlock key={i} file={file} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
