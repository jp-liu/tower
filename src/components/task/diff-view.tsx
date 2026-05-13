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
    // Fallback: parse-diff couldn't extract a file/chunks (unusual filename,
    // binary marker, malformed patch). If the raw patch still has content,
    // render it as monospace plaintext so the user at least sees SOMETHING
    // instead of a blank tab. Otherwise show the empty-state message.
    if (patch && patch.trim().length > 0) {
      return (
        <pre className="px-4 py-2 text-xs font-mono whitespace-pre overflow-auto text-foreground">
          {patch}
        </pre>
      );
    }
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
        // the individual change lines in chunk.changes[*].content with marker.
        const hunkLines: string[] = [chunk.content];
        for (const change of chunk.changes) {
          hunkLines.push(change.content);
        }
        const hunkString = hunkLines.join("\n");

        // @git-diff-view/react REQUIRES oldFile.content + newFile.content to
        // render anything; hunks alone produces an empty body. Reconstruct
        // per-chunk content from changes — strip the leading marker so the
        // library reapplies its own colors. Lines: " " context → both sides;
        // "+" → newFile only; "-" → oldFile only.
        const oldContent = chunk.changes
          .filter((c) => c.type !== "add")
          .map((c) => c.content.slice(1))
          .join("\n");
        const newContent = chunk.changes
          .filter((c) => c.type !== "del")
          .map((c) => c.content.slice(1))
          .join("\n");

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
                // Convert parse-diff's "/dev/null" sentinel for new/deleted
                // files into undefined — the library treats "/dev/null" as a
                // real path and tries to syntax-highlight it, which can lead
                // to rendering quirks.
                oldFile: {
                  fileName:
                    file.from && file.from !== "/dev/null" ? file.from : undefined,
                  fileLang: language,
                  // Empty string content for new files makes the lib bail out;
                  // pass undefined so it falls back to hunk-only rendering.
                  content: oldContent.length > 0 ? oldContent : undefined,
                },
                newFile: {
                  fileName:
                    file.to && file.to !== "/dev/null" ? file.to : undefined,
                  fileLang: language,
                  content: newContent.length > 0 ? newContent : undefined,
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
