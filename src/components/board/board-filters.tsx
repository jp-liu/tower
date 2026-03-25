"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

type FilterType = "ALL" | "IN_PROGRESS" | "IN_REVIEW";

interface BoardFiltersProps {
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  onCreateTask: () => void;
}

const FILTERS: { id: FilterType; label: string }[] = [
  { id: "ALL", label: "全部" },
  { id: "IN_PROGRESS", label: "执行中" },
  { id: "IN_REVIEW", label: "待评审" },
];

export function BoardFilters({
  activeFilter,
  onFilterChange,
  onCreateTask,
}: BoardFiltersProps) {
  return (
    <div className="flex items-center gap-2 px-6 py-2">
      {FILTERS.map((filter) => (
        <button
          key={filter.id}
          onClick={() => onFilterChange(filter.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            activeFilter === filter.id
              ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          {filter.label}
        </button>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="ml-auto h-7 gap-1.5 border-border text-xs text-muted-foreground hover:border-amber-500/30 hover:text-amber-300"
        onClick={onCreateTask}
      >
        <Plus className="h-3.5 w-3.5" />
        新建任务
      </Button>
    </div>
  );
}
