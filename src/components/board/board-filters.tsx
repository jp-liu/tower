"use client";

import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface BoardFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCreateTask: () => void;
}

export function BoardFilters({
  searchQuery,
  onSearchChange,
  onCreateTask,
}: BoardFiltersProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 px-6 py-2">
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("board.searchPlaceholder")}
          className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto h-7 gap-1.5 border-border text-xs text-muted-foreground hover:border-amber-500/30 hover:text-amber-300"
        onClick={onCreateTask}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("board.newTask")}
      </Button>
    </div>
  );
}
