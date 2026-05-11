"use client";

import { useMemo } from "react";
// NOTE: library exports DiffView — alias to avoid collision with our wrapper
import { DiffView as GitDiffView, DiffModeEnum } from "@git-diff-view/react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { parseUnifiedDiff, hunkToPatch } from "@/lib/git-diff";
import type { DiffFile, DiffChunk } from "@/lib/git-diff";

export interface DiffViewProps {
  patch: string;
  language?: string;
  onStageHunk?: (hunkPatch: string) => void;
  onDiscardHunk?: (hunkPatch: string) => void;
}

/**
 * Single-file unified-diff renderer backed by @git-diff-view/react.
 *
 * Accepts a raw unified diff `patch` string and optional `onStageHunk` /
 * `onDiscardHunk` callbacks (Phase 3). When callbacks are provided, a small
 * toolbar appears above each hunk with Stage / Discard buttons.
 */
export function DiffView({
  patch,
  language = "plaintext",
  onStageHunk,
  onDiscardHunk,
}: DiffViewProps) {
  const { t } = useI18n();

  // Parse the raw unified diff into an array of file diffs. We operate on
  // the first file only (single-file component contract).
  const file: DiffFile | undefined = useMemo(
    () => parseUnifiedDiff(patch)[0],
    [patch]
  );

  if (!file || file.chunks.length === 0) {
    return (
      <div className="px-4 py-2 text-xs text-muted-foreground">
        {t("diff.noChanges")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {file.chunks.map((chunk: DiffChunk, idx: number) => {
        // Build the hunks array expected by @git-diff-view/react's `data` prop.
        // Each element is a raw hunk string (header + lines).
        // NOTE: parse-diff stores the raw hunk header in chunk.content and
        // the individual change lines in chunk.changes[*].content.
        const hunkLines: string[] = [chunk.content];
        for (const change of chunk.changes) {
          hunkLines.push(change.content);
        }
        const hunkString = hunkLines.join("\n");

        return (
          <div
            key={idx}
            className="border border-border rounded-md overflow-hidden"
          >
            {(onStageHunk || onDiscardHunk) && (
              <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-muted/30">
                <span className="text-[10px] font-mono text-muted-foreground flex-1">
                  {chunk.content}
                </span>
                {onStageHunk && (
                  <Button
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => onStageHunk(hunkToPatch(file, chunk))}
                  >
                    {t("git.stageHunk")}
                  </Button>
                )}
                {onDiscardHunk && (
                  <Button
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => onDiscardHunk(hunkToPatch(file, chunk))}
                  >
                    {t("git.discardHunk")}
                  </Button>
                )}
              </div>
            )}
            {/* @git-diff-view/react renders the hunk via its `data` prop.
                hunks must be an array of raw hunk strings. oldFile/newFile
                content is omitted so the library renders diff-only mode. */}
            <GitDiffView
              data={{
                oldFile: {
                  fileName: file.from ?? undefined,
                  fileLang: language,
                },
                newFile: {
                  fileName: file.to ?? undefined,
                  fileLang: language,
                },
                hunks: [hunkString],
              }}
              diffViewMode={DiffModeEnum.Unified}
              diffViewTheme="dark"
              diffViewHighlight
            />
          </div>
        );
      })}
    </div>
  );
}
