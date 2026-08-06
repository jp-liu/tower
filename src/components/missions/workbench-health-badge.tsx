"use client";

import { Activity, AlertTriangle } from "lucide-react";
import type { ActiveExecutionInfo } from "@/actions/agent-actions";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { projectWorkbenchHealth } from "./workbench-health";

type WorkbenchHealthBadgeProps = Pick<
  ActiveExecutionInfo,
  "isSystemTask" | "workbenchRuntime"
>;

export function WorkbenchHealthBadge({
  isSystemTask,
  workbenchRuntime,
}: WorkbenchHealthBadgeProps) {
  const { locale, t } = useI18n();
  if (!isSystemTask) return null;

  const presentation = projectWorkbenchHealth(workbenchRuntime, locale, t);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className={
              presentation.unhealthy
                ? "text-[10px] text-amber-600 border-amber-500/40 bg-amber-500/10 shrink-0"
                : "text-[10px] text-emerald-600 border-emerald-500/40 bg-emerald-500/10 shrink-0"
            }
          />
        }
      >
        {presentation.unhealthy
          ? <AlertTriangle className="h-3 w-3 mr-1" />
          : <Activity className="h-3 w-3 mr-1" />}
        {presentation.badgeLabel}
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {presentation.detailRows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="contents">
              <dt className="text-background/70">{row.label}</dt>
              <dd className="min-w-0 break-words">{row.value}</dd>
            </div>
          ))}
        </dl>
      </TooltipContent>
    </Tooltip>
  );
}
