"use client";

import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("board.searchPlaceholder")}
          className="pl-8 pr-3 text-xs"
        />
      </div>
      <Button
        data-tour="create-task"
        variant="outline"
        className="ml-auto gap-1.5 border-border text-xs text-muted-foreground hover:border-primary/30 hover:text-primary"
        onClick={onCreateTask}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("board.newTask")}
      </Button>
    </div>
  );
}
