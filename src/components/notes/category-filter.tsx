"use client";

import { NOTE_CATEGORIES_PRESET } from "@/lib/constants";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface CategoryFilterProps {
  active: string;
  onSelect: (cat: string) => void;
}

export function CategoryFilter({ active, onSelect }: CategoryFilterProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => onSelect("all")}
        className={cn(
          "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
          active === "all"
            ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/20"
            : "text-muted-foreground hover:bg-accent"
        )}
      >
        {t("notes.allCategories")}
      </button>
      {NOTE_CATEGORIES_PRESET.map((cat) => (
        <button
          key={cat}
          onClick={() => onSelect(cat)}
          className={cn(
            "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
            active === cat
              ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/20"
              : "text-muted-foreground hover:bg-accent"
          )}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
