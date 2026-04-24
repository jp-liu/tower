"use client";

import { useState } from "react";
import {
  Check, File, FilePlus, FileMinus, FileQuestion, FileEdit,
  Loader2, ArrowDown, ArrowUp, ChevronDown, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { gitAction } from "@/lib/git-api";

interface ChangedFile {
  file: string;
  status: string;
  staged: boolean;
}

interface GitChangesPanelProps {
  localPath: string;
  changedFiles: ChangedFile[];
  ahead: number;
  behind: number;
  hasRemote: boolean;
  onRefresh: () => Promise<void>;
}

const STATUS_ICON: Record<string, typeof File> = {
  modified: FileEdit,
  added: FilePlus,
  deleted: FileMinus,
  untracked: FileQuestion,
  renamed: FileEdit,
};

const STATUS_COLOR: Record<string, string> = {
  modified: "text-amber-400",
  added: "text-emerald-400",
  deleted: "text-rose-400",
  untracked: "text-muted-foreground",
  renamed: "text-sky-400",
};

export function GitChangesPanel({
  localPath,
  changedFiles,
  ahead,
  behind,
  hasRemote,
  onRefresh,
}: GitChangesPanelProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);

  const stagedFiles = changedFiles.filter((f) => f.staged);
  const unstagedFiles = changedFiles.filter((f) => !f.staged);

  const handleStage = async (files: string[]) => {
    try {
      await gitAction(localPath, "stage", { files });
      await onRefresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUnstage = async (files: string[]) => {
    try {
      await gitAction(localPath, "unstage", { files });
      await onRefresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim() || stagedFiles.length === 0) return;
    setCommitting(true);
    try {
      await gitAction(localPath, "commit", { message: commitMsg });
      setCommitMsg("");
      toast.success(t("git.commitSuccess"));
      await onRefresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    try {
      await gitAction(localPath, "pull");
      toast.success(t("git.pullSuccess"));
      await onRefresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    try {
      await gitAction(localPath, "push");
      toast.success(t("git.pushSuccess"));
      await onRefresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
    }
  };

  if (changedFiles.length === 0 && ahead === 0 && behind === 0) return null;

  return (
    <div className="space-y-3">
      {/* Pull / Push */}
      {hasRemote && (ahead > 0 || behind > 0) && (
        <div className="flex items-center gap-2">
          {behind > 0 && (
            <Button
              variant="outline"
              className="flex-1 h-7 gap-1.5 text-xs"
              onClick={handlePull}
              disabled={pulling}
            >
              {pulling ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDown className="h-3 w-3" />}
              {t("git.pull")} ({behind})
            </Button>
          )}
          {ahead > 0 && (
            <Button
              variant="outline"
              className="flex-1 h-7 gap-1.5 text-xs"
              onClick={handlePush}
              disabled={pushing}
            >
              {pushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUp className="h-3 w-3" />}
              {t("git.push")} ({ahead})
            </Button>
          )}
        </div>
      )}

      {/* Changes section */}
      {changedFiles.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex w-full items-center justify-between py-1"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("git.changes")} ({changedFiles.length})
            </p>
            {expanded
              ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
              : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </button>

          {expanded && (
            <div className="mt-1.5 space-y-2">
              {/* Staged files */}
              {stagedFiles.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-emerald-400 font-medium">
                      {t("git.stagedChanges")} ({stagedFiles.length})
                    </p>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground text-[10px] h-5 w-auto px-1"
                      onClick={() => handleUnstage(stagedFiles.map((f) => f.file))}
                    >
                      {t("git.unstageAll")}
                    </Button>
                  </div>
                  <div className="space-y-0.5">
                    {stagedFiles.map((f) => (
                      <FileItem
                        key={`staged-${f.file}`}
                        file={f}
                        onClick={() => handleUnstage([f.file])}
                        actionLabel="−"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Unstaged files */}
              {unstagedFiles.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-muted-foreground font-medium">
                      {t("git.unstagedChanges")} ({unstagedFiles.length})
                    </p>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground text-[10px] h-5 w-auto px-1"
                      onClick={() => handleStage(unstagedFiles.map((f) => f.file))}
                    >
                      {t("git.stageAll")}
                    </Button>
                  </div>
                  <div className="space-y-0.5">
                    {unstagedFiles.map((f) => (
                      <FileItem
                        key={`unstaged-${f.file}`}
                        file={f}
                        onClick={() => handleStage([f.file])}
                        actionLabel="+"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Commit message + button */}
              {stagedFiles.length > 0 && (
                <div className="border-t border-border pt-2 space-y-2">
                  <Textarea
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    placeholder={t("git.commitMsgPlaceholder")}
                    rows={2}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring resize-none"
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        handleCommit();
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    className="w-full h-7 gap-1.5 text-xs"
                    onClick={handleCommit}
                    disabled={committing || !commitMsg.trim()}
                  >
                    {committing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    {t("git.commit")} ({stagedFiles.length})
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileItem({
  file,
  onClick,
  actionLabel,
}: {
  file: ChangedFile;
  onClick: () => void;
  actionLabel: string;
}) {
  const Icon = STATUS_ICON[file.status] || File;
  const color = STATUS_COLOR[file.status] || "text-muted-foreground";
  const fileName = file.file.split("/").pop() || file.file;
  const dirPath = file.file.includes("/") ? file.file.slice(0, file.file.lastIndexOf("/") + 1) : "";

  return (
    <div className="group flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent transition-colors">
      <Icon className={`h-3 w-3 shrink-0 ${color}`} />
      <div className="flex-1 min-w-0 flex items-baseline gap-0.5">
        <span className="truncate text-xs text-foreground">{fileName}</span>
        {dirPath && (
          <span className="truncate text-[10px] text-muted-foreground">{dirPath}</span>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="shrink-0 rounded px-1 text-xs font-mono text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground transition-all"
      >
        {actionLabel}
      </button>
    </div>
  );
}
