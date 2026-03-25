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
  { id: "ALL", label: "\u5168\u90E8" },
  { id: "IN_PROGRESS", label: "\u6267\u884C\u4E2D" },
  { id: "IN_REVIEW", label: "\u5F85\u8BC4\u5BA1" },
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
          className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
            activeFilter === filter.id
              ? "border-violet-200 bg-violet-50 text-violet-700 font-medium"
              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          {filter.label}
        </button>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="ml-auto gap-1.5"
        onClick={onCreateTask}
      >
        <Plus className="h-4 w-4" />
        新建任务
      </Button>
    </div>
  );
}
