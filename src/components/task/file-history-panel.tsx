"use client";

import { useState, useEffect } from "react";
import { Loader2, GitCommitHorizontal } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n";
import { gitAction } from "@/lib/git-api";

interface Commit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface FileHistoryPanelProps {
  worktreePath: string;
  relativePath: string;
  onClose: () => void;
  onSelectCommit?: (commitHash: string) => void;
}

function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = Date.now();
    const diff = now - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 30) {
      return date.toLocaleDateString();
    }
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "just now";
  } catch {
    return dateStr;
  }
}

export function FileHistoryPanel(props: FileHistoryPanelProps) {
  return <FileHistoryPanelState key={`${props.worktreePath}:${props.relativePath}`} {...props} />;
}

function FileHistoryPanelState({
  worktreePath,
  relativePath,
  onSelectCommit,
}: FileHistoryPanelProps) {
  const { t } = useI18n();
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!worktreePath || !relativePath) return;
    gitAction(worktreePath, "log-file", { file: relativePath })
      .then((res) => {
        const data = res as { commits?: Commit[] };
        setCommits(data.commits ?? []);
      })
      .catch(() => {
        setCommits([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [worktreePath, relativePath]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center px-4">
        <GitCommitHorizontal className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("git.noHistory")}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <ul className="py-1">
        {commits.map((commit) => (
          <li key={commit.hash}>
            <button
              type="button"
              title={t("git.viewCommit")}
              className="w-full text-left px-3 py-2 hover:bg-accent transition-colors group"
              onClick={() => onSelectCommit?.(commit.hash)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs text-muted-foreground shrink-0 group-hover:text-foreground transition-colors">
                  {commit.shortHash}
                </span>
                <span className="text-xs text-foreground truncate flex-1">
                  {commit.message.split("\n")[0]}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                <span className="truncate">{commit.author}</span>
                <span className="shrink-0">{formatRelativeTime(commit.date)}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
