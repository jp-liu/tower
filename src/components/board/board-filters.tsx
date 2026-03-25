"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

type FilterType = "ALL" | "IN_PROGRESS" | "IN_REVIEW";

interface BoardFiltersProps {
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  onCreateTask: () => void;
}

const FILTER_KEYS: { id: FilterType; key: "board.allFilter" | "board.inProgressFilter" | "board.inReviewFilter" }[] = [
  { id: "ALL", key: "board.allFilter" },
  { id: "IN_PROGRESS", key: "board.inProgressFilter" },
  { id: "IN_REVIEW", key: "board.inReviewFilter" },
];

export function BoardFilters({
  activeFilter,
  onFilterChange,
  onCreateTask,
}: BoardFiltersProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 px-6 py-2">
      {FILTER_KEYS.map((filter) => (
        <button
          key={filter.id}
          onClick={() => onFilterChange(filter.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            activeFilter === filter.id
              ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          {t(filter.key)}
        </button>
      ))}
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
