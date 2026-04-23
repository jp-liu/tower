"use client";

import { ArrowLeft, GitBranch, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface TaskMetadataProps {
  title: string;
  description?: string;
  branch?: string;
  baseBranch?: string | null;
  hasConversation: boolean;
  updatedAt: Date;
  onBack: () => void;
}

export function TaskMetadata({
  title,
  description,
  branch,
  baseBranch,
  hasConversation,
  updatedAt,
  onBack,
}: TaskMetadataProps) {
  const { t } = useI18n();
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary">{t("taskDetail.title")}</span>
        </div>
        <Button
          variant="ghost"
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground h-auto px-2 py-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("taskDetail.back")}
        </Button>
      </div>

      <h2 className="mt-2.5 text-lg font-bold tracking-tight text-foreground">{title}</h2>

      {description && (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{description}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {baseBranch ? (
          <Badge variant="secondary" className="bg-muted text-muted-foreground text-[10px] font-mono border border-border">
            <GitBranch className="mr-1 h-3 w-3" />
            {baseBranch} · worktree
          </Badge>
        ) : branch ? (
          <Badge variant="secondary" className="bg-muted text-muted-foreground text-[10px] font-mono border border-border">
            {t("taskDetail.directMode")}
          </Badge>
        ) : null}
        {hasConversation && (
          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 text-[10px] border border-emerald-500/20">
            {t("taskDetail.hasConversation")}
          </Badge>
        )}
        <span className="text-[11px] text-muted-foreground">
          {t("taskDetail.updatedAt")} {formatRelativeTime(updatedAt)}
        </span>
      </div>
    </div>
  );
}
