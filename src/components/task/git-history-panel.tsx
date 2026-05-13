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

interface CommitFile {
  filename: string;
  added: number;
  removed: number;
  isBinary: boolean;
}

export interface GitHistoryPanelProps {
  worktreePath: string;
  onSelectCommitFile?: (params: {
    commitHash: string;
    relativePath: string;
    originalContent: string;
    modifiedContent: string;
  }) => void;
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

  // Fetch commit details when a commit is selected. Only the file list is
  // needed now — per-file before/after content is fetched on demand when the
  // user clicks a file (via commit-file-content action).
  useEffect(() => {
    if (!selectedHash || !worktreePath) {
      setCommitFiles([]);
      return;
    }
    let cancelled = false;
    setLoadingFiles(true);
    gitAction(worktreePath, "show-commit", { hash: selectedHash })
      .then((res) => {
        if (cancelled) return;
        const data = res as { files?: CommitFile[] };
        setCommitFiles(data.files ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setCommitFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedHash, worktreePath]);

  const handleFileClick = async (filename: string) => {
    if (!selectedHash || !onSelectCommitFile) return;
    try {
      const res = (await gitAction(worktreePath, "commit-file-content", {
        hash: selectedHash,
        file: filename,
      })) as { before: string | null; after: string | null };
      onSelectCommitFile({
        commitHash: selectedHash,
        relativePath: filename,
        originalContent: res.before ?? "",
        modifiedContent: res.after ?? "",
      });
    } catch {
      // Fallback: pass empty strings so the tab still opens with empty diff
      onSelectCommitFile({
        commitHash: selectedHash,
        relativePath: filename,
        originalContent: "",
        modifiedContent: "",
      });
    }
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

  // Compute graph gutter width (px) — hugs actual laneCount, capped to 192px.
  const graphGutter = Math.min(Math.max(layout.laneCount * 16 + 16, 32), 192);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Single scroll area. Graph SVG is absolute-positioned and the commit
          list sits underneath it; each row's `paddingLeft = graphGutter` keeps
          text from overlapping the SVG. This is the VSCode Git Graph layout
          — dots fuse with their row visually. */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="relative">
          {/* Graph SVG — absolute, overlays the list's left gutter. */}
          <div
            className="absolute left-0 top-0 z-10 pointer-events-none"
            style={{ width: `${graphGutter}px` }}
          >
            <div className="pointer-events-auto overflow-x-auto scrollbar-thin" style={{ width: `${graphGutter}px` }}>
              <GitGraphSvg
                layout={layout}
                selectedCommitHash={selectedHash}
                onCommitClick={setSelectedHash}
              />
            </div>
          </div>

          {/* Commit list — full width; left padding leaves room for the SVG. */}
          <ul className="w-full">
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
                    className={`group relative flex items-center gap-2 pr-2 cursor-pointer hover:bg-accent/50 ${
                      isSelected ? "bg-accent/30" : ""
                    }`}
                    style={{
                      height: `${ROW_HEIGHT}px`,
                      paddingLeft: `${graphGutter + 8}px`,
                    }}
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

                </React.Fragment>
              );
            })}
          </ul>
        </div>
      </ScrollArea>

      {/* Bottom: files-changed panel for the selected commit. Separate block
          so the SVG↔commit-row alignment never jitters when files load. */}
      {selectedHash && (
        <div
          className="shrink-0 border-t-2 border-border bg-muted/30 flex flex-col"
          data-testid="commit-files-panel"
          style={{ height: "min(50%, 360px)", minHeight: "120px" }}
        >
          <div className="shrink-0 px-3 py-2 text-xs font-semibold tracking-wide text-foreground border-b border-border flex items-center gap-2">
            <FileEdit className="h-3.5 w-3.5 text-amber-400" />
            <span>{t("git.commitFiles")}</span>
            {commitFiles.length > 0 && (
              <span className="text-muted-foreground font-normal">({commitFiles.length})</span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {loadingFiles ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : commitFiles.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground">—</div>
            ) : (
              <ul className="py-1">
                {commitFiles.map((file) => (
                  <li
                    key={file.filename}
                    onClick={() => handleFileClick(file.filename)}
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent/60 transition-colors"
                    data-testid="commit-file-row"
                    title={file.filename}
                  >
                    <FileEdit className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span className="text-sm text-foreground truncate flex-1 min-w-0">
                      {file.filename}
                    </span>
                    <span className="shrink-0 text-xs font-mono text-emerald-400">
                      +{file.added}
                    </span>
                    <span className="shrink-0 text-xs font-mono text-rose-400">
                      -{file.removed}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

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
