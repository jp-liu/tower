"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, GitCommitVertical, Copy } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

interface Commit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

interface GitLogPanelProps {
  commits: Commit[];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export function GitLogPanel({ commits }: GitLogPanelProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  if (commits.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between py-1"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("git.commitLog")}
        </p>
        {expanded
          ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
          : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-0.5 max-h-64 overflow-y-auto">
          {commits.map((c) => (
            <div
              key={c.hash}
              className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent transition-colors"
            >
              <GitCommitVertical className="h-3 w-3 shrink-0 text-muted-foreground mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground line-clamp-1">{c.message}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(c.shortHash);
                      toast.success(`Copied ${c.shortHash}`);
                    }}
                    className="flex items-center gap-0.5 font-mono text-[10px] text-primary/70 hover:text-primary transition-colors"
                  >
                    {c.shortHash}
                    <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                  <span className="text-[10px] text-muted-foreground">{c.author}</span>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(c.date)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
