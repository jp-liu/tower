"use client";

import Link from "next/link";
import { Plus, Search, GitBranch, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

interface VersionOption {
  id: string;
  number: string;
  name: string;
}

interface BoardFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  versions?: VersionOption[];
  versionFilter?: string; // "all" | "backlog" | versionId
  onVersionFilterChange?: (value: string) => void;
  versionsHref?: string;
  onCreateTask: () => void;
}

export function BoardFilters({
  searchQuery,
  onSearchChange,
  versions = [],
  versionFilter = "all",
  onVersionFilterChange,
  versionsHref,
  onCreateTask,
}: BoardFiltersProps) {
  const { t } = useI18n();

  const versionLabel =
    versionFilter === "all"
      ? t("board.allVersions")
      : versionFilter === "backlog"
        ? t("board.backlogFilter")
        : (() => {
            const v = versions.find((x) => x.id === versionFilter);
            return v ? `${v.number} ${v.name}` : t("board.allVersions");
          })();

  return (
    <div className="flex items-center gap-2 px-6 py-2">
      {/* Filter conditions (version + search) on the left */}
      {onVersionFilterChange && (
        <Select
          value={versionFilter}
          onValueChange={(v) => onVersionFilterChange(v || "all")}
        >
          <SelectTrigger className="h-8 w-44 shrink-0 gap-1.5 text-xs text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{versionLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("board.allVersions")}</SelectItem>
            <SelectItem value="backlog">{t("board.backlogFilter")}</SelectItem>
            {versions.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                <span className="font-mono">{v.number}</span> {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("board.searchPlaceholder")}
          className="pl-8 pr-3 text-xs"
        />
      </div>

      {/* Actions on the right: tip + version timeline + new task */}
      <div className="ml-auto flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className="text-muted-foreground">
                <Lightbulb className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent side="bottom" className="max-w-xs">
            {t("board.tipText")}
          </TooltipContent>
        </Tooltip>
        {versionsHref && (
          <Link href={versionsHref}>
            <Button variant="outline" className="h-8 gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              {t("version.timeline")}
            </Button>
          </Link>
        )}
        <Button
          data-tour="create-task"
          variant="outline"
          className="gap-1.5 border-border text-xs text-muted-foreground hover:border-primary/30 hover:text-primary"
          onClick={onCreateTask}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("board.newTask")}
        </Button>
      </div>
    </div>
  );
}
