"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n";
import { gitAction } from "@/lib/git-api";
import { layoutGraph, type RawCommit } from "@/lib/git-graph-layout";
import { GitGraphSvg } from "./git-graph-svg";
import { formatBlameAge } from "./blame-overlay";
import { FileEdit, Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommitActionMenu } from "./commit-action-menu";

// Must match GitGraphSvg's ROW_HEIGHT constant
const ROW_HEIGHT = 28;
// Per-file row inside the inline expansion (no SVG dot here)
const FILE_ROW_HEIGHT = 24;

interface CommitFile {
  filename: string;
  added: number;
  removed: number;
  isBinary: boolean;
}

export interface GitHistoryPanelProps {
  worktreePath: string;
  onSelectCommitFile?: (
    commitHash: string,
    relativePath: string,
    patch: string
  ) => void;
}

/**
 * Slice the per-file portion of a full git patch.
 * Finds the "diff --git a/<filename>" marker and returns that chunk.
 */
function slicePerFilePatch(fullPatch: string, filename: string): string {
  const markers = fullPatch.split(/^diff --git /m);
  for (let i = 1; i < markers.length; i++) {
    const chunk = "diff --git " + markers[i];
    const firstLine = chunk.split("\n")[0] ?? "";
    if (
      firstLine.includes(`a/${filename}`) ||
      firstLine.includes(`b/${filename}`)
    ) {
      return chunk;
    }
  }
  return "";
}

export function GitHistoryPanel({
  worktreePath,
  onSelectCommitFile,
}: GitHistoryPanelProps) {
  const { t } = useI18n();
  const [commits, setCommits] = useState<RawCommit[]>([]);
  const [head, setHead] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [commitPatch, setCommitPatch] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    hash: string;
    x?: number;
    y?: number;
  } | null>(null);
  const [refetchTick, setRefetchTick] = useState(0);

  // Fetch the graph on mount + when worktreePath changes + when refetchTick changes
  useEffect(() => {
    if (!worktreePath) return;
    let cancelled = false;
    setLoading(true);
    gitAction(worktreePath, "log-graph", {})
      .then((res) => {
        if (cancelled) return;
        const data = res as { commits?: RawCommit[]; head?: string | null };
        setCommits(data.commits ?? []);
        setHead(data.head ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setCommits([]);
        setHead(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [worktreePath, refetchTick]);

  const handleActionComplete = () => {
    setRefetchTick((t) => t + 1);
  };

  const handleMoreButtonClick = (e: React.MouseEvent, hash: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({ hash, x: rect.right, y: rect.bottom });
  };

  // Fetch commit details when a commit is selected
  useEffect(() => {
    if (!selectedHash || !worktreePath) {
      setCommitFiles([]);
      setCommitPatch("");
      return;
    }
    let cancelled = false;
    setLoadingFiles(true);
    gitAction(worktreePath, "show-commit", { hash: selectedHash })
      .then((res) => {
        if (cancelled) return;
        const data = res as { patch?: string; files?: CommitFile[] };
        setCommitPatch(data.patch ?? "");
        setCommitFiles(data.files ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setCommitPatch("");
        setCommitFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedHash, worktreePath]);

  const handleFileClick = (filename: string) => {
    if (!selectedHash || !onSelectCommitFile) return;
    const perFilePatch = slicePerFilePatch(commitPatch, filename);
    onSelectCommitFile(selectedHash, filename, perFilePatch);
  };

  const layout = useMemo(() => layoutGraph(commits), [commits]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">{t("git.noCommits")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Single scroll area: graph SVG + commit list (with inline file
          expansion under the selected commit, VSCode-style). */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex">
          {/* Left: graph SVG column. Width hugs actual laneCount so dots stay
              visually close to the commit subject (no big empty gap for narrow
              graphs). Capped at 192px (12 lanes) — wider repos scroll inside. */}
          <div
            className="flex-none overflow-x-auto scrollbar-thin"
            style={{
              width: `${Math.min(
                Math.max(layout.laneCount * 16 + 16, 32),
                192
              )}px`,
            }}
          >
            <GitGraphSvg
              layout={layout}
              selectedCommitHash={selectedHash}
              onCommitClick={setSelectedHash}
              expandedAt={
                selectedHash && commitFiles.length > 0
                  ? {
                      afterRow:
                        layout.commits.find((c) => c.hash === selectedHash)?.row ?? 0,
                      extraRows: Math.ceil(
                        ((loadingFiles ? 1 : Math.max(commitFiles.length, 1)) *
                          FILE_ROW_HEIGHT) /
                          ROW_HEIGHT
                      ),
                    }
                  : null
              }
            />
          </div>

          {/* Right: commit list — interleaves file rows after the selected commit. */}
          <ul className="flex-1 min-w-0">
            {commits.map((commit) => {
              const isSelected = commit.hash === selectedHash;
              return (
                <React.Fragment key={commit.hash}>
                  <li
                    onClick={() => setSelectedHash(commit.hash)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ hash: commit.hash, x: e.clientX, y: e.clientY });
                    }}
                    className={`group relative flex items-center gap-2 px-2 cursor-pointer hover:bg-accent/50 border-l-2 ${
                      isSelected
                        ? "border-primary bg-accent/30"
                        : "border-transparent"
                    }`}
                    style={{ height: `${ROW_HEIGHT}px` }}
                    data-testid="commit-row"
                    data-hash={commit.hash}
                  >
                    <span
                      className="truncate text-xs text-foreground flex-1 min-w-0"
                      title={commit.subject}
                    >
                      {commit.subject}
                    </span>
                    {/* Ref badges — HEAD, branches, tags inline (was tooltip-only) */}
                    {commit.refs.length > 0 && (
                      <span className="flex items-center gap-1 shrink-0">
                        {commit.refs.slice(0, 2).map((r) => (
                          <span
                            key={r}
                            className="px-1.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono leading-4 truncate max-w-[120px]"
                            title={r}
                          >
                            {r}
                          </span>
                        ))}
                        {commit.refs.length > 2 && (
                          <span
                            className="text-[10px] text-muted-foreground font-mono"
                            title={commit.refs.slice(2).join(", ")}
                          >
                            +{commit.refs.length - 2}
                          </span>
                        )}
                      </span>
                    )}
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {commit.shortHash}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground truncate max-w-[80px]">
                      {commit.author}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatBlameAge(commit.date)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleMoreButtonClick(e, commit.hash)}
                      aria-label="More actions"
                      data-testid="commit-more-button"
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </Button>
                  </li>

                  {/* Inline file expansion — VSCode Git Graph style. Renders
                      directly under the selected commit's row; the SVG
                      reserves matching empty space via expandedAt. */}
                  {isSelected && (
                    <li className="bg-accent/10 border-l-2 border-primary">
                      {loadingFiles ? (
                        <div
                          className="flex items-center justify-center"
                          style={{ height: `${FILE_ROW_HEIGHT}px` }}
                        >
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        </div>
                      ) : commitFiles.length === 0 ? (
                        <div
                          className="flex items-center px-6 text-[11px] text-muted-foreground"
                          style={{ height: `${FILE_ROW_HEIGHT}px` }}
                        >
                          {t("git.noCommits")}
                        </div>
                      ) : (
                        <ul>
                          {commitFiles.map((file) => (
                            <li
                              key={file.filename}
                              onClick={() => handleFileClick(file.filename)}
                              className="flex items-center gap-1.5 pl-8 pr-3 cursor-pointer hover:bg-accent/40"
                              style={{ height: `${FILE_ROW_HEIGHT}px` }}
                              data-testid="commit-file-row"
                            >
                              <FileEdit className="h-3 w-3 shrink-0 text-amber-400" />
                              <span className="text-[11px] text-foreground truncate flex-1 min-w-0">
                                {file.filename}
                              </span>
                              <span className="shrink-0 text-[10px] font-mono text-emerald-400">
                                +{file.added}
                              </span>
                              <span className="shrink-0 text-[10px] font-mono text-rose-400">
                                -{file.removed}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )}
                </React.Fragment>
              );
            })}
          </ul>
        </div>
      </ScrollArea>

      {/* Context menu — controlled by contextMenu state */}
      {contextMenu && (
        <CommitActionMenu
          worktreePath={worktreePath}
          commit={commits.find((c) => c.hash === contextMenu.hash)!}
          currentHead={head}
          open={!!contextMenu}
          onOpenChange={(open) => {
            if (!open) setContextMenu(null);
          }}
          anchorPosition={
            contextMenu.x !== undefined && contextMenu.y !== undefined
              ? { x: contextMenu.x, y: contextMenu.y }
              : undefined
          }
          onActionComplete={handleActionComplete}
        />
      )}
    </div>
  );
}
