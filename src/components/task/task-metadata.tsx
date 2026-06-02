"use client";

import { ArrowLeft, GitBranch, Sparkles, FolderSearch, Code, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/utils";
import { TaskVersionTag } from "@/components/version/version-badges";
import { openInFileManager, openInEditor, openInTerminal } from "@/actions/preview-actions";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

interface TaskMetadataProps {
  title: string;
  description?: string;
  branch?: string;
  baseBranch?: string | null;
  version?: { number: string; name: string } | null;
  hasConversation: boolean;
  updatedAt: Date;
  /** Directory to open externally (worktree dir, or project dir + subPath) */
  openDir?: string | null;
  onBack: () => void;
}

export function TaskMetadata({
  title,
  description,
  branch,
  baseBranch,
  version,
  hasConversation,
  updatedAt,
  openDir,
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
        {version && (
          <TaskVersionTag number={version.number} name={version.name} showName />
        )}
        {hasConversation && (
          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 text-[10px] border border-emerald-500/20">
            {t("taskDetail.hasConversation")}
          </Badge>
        )}
        <span className="text-[11px] text-muted-foreground">
          {t("taskDetail.updatedAt")} {formatRelativeTime(updatedAt)}
        </span>
        {openDir && (
          <div className="ml-auto flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={async () => {
                      try {
                        await openInFileManager(openDir);
                      } catch (err) {
                        console.error("openInFileManager failed:", err);
                        toast.error(t("git.openInFileManagerFailed"));
                      }
                    }}
                  >
                    <FolderSearch className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <TooltipContent side="bottom">{t("git.openInFileManager")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={async () => {
                      try {
                        await openInEditor(openDir);
                      } catch (err) {
                        console.error("openInEditor failed:", err);
                        toast.error(t("git.openInEditorFailed"));
                      }
                    }}
                  >
                    <Code className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <TooltipContent side="bottom">{t("git.openInEditor")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={async () => {
                      try {
                        await openInTerminal(openDir);
                      } catch (err) {
                        console.error("openInTerminal failed:", err);
                        toast.error(t("git.openInTerminalFailed"));
                      }
                    }}
                  >
                    <Terminal className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <TooltipContent side="bottom">{t("git.openInTerminal")}</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}
