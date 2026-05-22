"use client";

import { ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { stripAnsi } from "@/lib/preview/url-extractor";

export interface PreviewLogDrawerProps {
  expanded: boolean;
  latestLogLine: string;
  onToggle: () => void;
  showInstallBanner: boolean;
  onInstallNow: () => void;
  onRunAnyway: () => void;
  /** Expanded mode 的内容（通常是 xterm 视图，由 parent 通过 dynamic 注入） */
  terminalSlot?: React.ReactNode;
}

export function PreviewLogDrawer({
  expanded,
  latestLogLine,
  onToggle,
  showInstallBanner,
  onInstallNow,
  onRunAnyway,
  terminalSlot,
}: PreviewLogDrawerProps) {
  const { t } = useI18n();
  const cleanLatest = stripAnsi(latestLogLine).slice(0, 200);

  return (
    <div className={`flex shrink-0 flex-col border-t border-border bg-card ${expanded ? "h-1/3" : ""}`}>
      {showInstallBanner && (
        <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-3 py-1.5 text-xs">
          <AlertTriangle className="size-3.5 text-amber-500" />
          <span className="flex-1 text-amber-400">{t("preview.installPrompt")}</span>
          <Button variant="default" onClick={onInstallNow}>
            {t("preview.installNow")}
          </Button>
          <Button variant="ghost" onClick={onRunAnyway}>
            {t("preview.runAnyway")}
          </Button>
        </div>
      )}
      <Button
        variant="ghost"
        onClick={onToggle}
        className="h-9 w-full shrink-0 justify-start gap-2 rounded-none border-b border-border bg-card px-3 text-xs font-normal"
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        <span className="font-medium">{t("preview.logsLabel")}:</span>
        <span className="truncate text-muted-foreground">{cleanLatest}</span>
      </Button>
      {expanded && (
        <div className="flex-1 overflow-hidden">
          {terminalSlot ?? <div className="size-full bg-black" />}
        </div>
      )}
    </div>
  );
}
