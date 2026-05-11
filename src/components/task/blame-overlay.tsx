"use client";

import { useState, useEffect } from "react";
import { Loader2, UserPen } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n";
import { gitAction } from "@/lib/git-api";

export interface BlameLine {
  line: number;
  sha: string;
  author: string;
  summary: string;
  date?: string;
}

export interface BlameListProps {
  worktreePath: string;
  relativePath: string;
}

function formatBlameAge(dateStr: string | undefined): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    const diff = Date.now() - date.getTime();
    const days = Math.floor(diff / 86400000);
    if (days > 365) return `${Math.floor(days / 365)}y ago`;
    if (days > 30) return `${Math.floor(days / 30)}mo ago`;
    if (days > 0) return `${days}d ago`;
    const hours = Math.floor(diff / 3600000);
    if (hours > 0) return `${hours}h ago`;
    return "just now";
  } catch {
    return "";
  }
}

export function BlameList({ worktreePath, relativePath }: BlameListProps) {
  const { t } = useI18n();
  const [lines, setLines] = useState<BlameLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!worktreePath || !relativePath) return;
    setLoading(true);
    setLines([]);

    gitAction(worktreePath, "blame", { file: relativePath })
      .then((res) => {
        const data = res as { lines?: BlameLine[] };
        setLines(data.lines ?? []);
      })
      .catch(() => {
        setLines([]);
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

  if (lines.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center px-4">
        <UserPen className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("git.noBlame")}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <ul className="py-1 font-mono text-xs" data-testid="blame-list">
        {lines.map((entry) => (
          <li
            key={entry.line}
            className="flex items-baseline gap-2 px-3 py-1 hover:bg-accent transition-colors group"
          >
            <span className="shrink-0 w-8 text-right text-muted-foreground select-none">
              {entry.line}
            </span>
            <span className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" data-testid="blame-sha">
              {entry.sha.slice(0, 7)}
            </span>
            <span className="truncate text-foreground flex-1" data-testid="blame-author">
              {entry.author}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {formatBlameAge(entry.date)}
            </span>
            <span className="truncate text-muted-foreground max-w-[200px]">
              {entry.summary}
            </span>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
