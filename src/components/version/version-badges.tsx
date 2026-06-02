"use client";

import { Milestone } from "lucide-react";
import { useI18n } from "@/lib/i18n";

// Custom version types have no stored color; assign a deterministic dark-safe
// accent by hashing the type name. Full literal class strings so Tailwind keeps them.
const TYPE_PALETTE = [
  "bg-sky-500/20 text-sky-300 border border-sky-500/30",
  "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  "bg-violet-500/20 text-violet-300 border border-violet-500/30",
  "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
  "bg-rose-500/20 text-rose-300 border border-rose-500/30",
  "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
  "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30",
];

function hashName(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function typeBadgeColor(name: string): string {
  return TYPE_PALETTE[hashName(name) % TYPE_PALETTE.length];
}

export const VERSION_STATUS_COLORS: Record<
  "PLANNED" | "ACTIVE" | "RELEASED",
  string
> = {
  PLANNED: "bg-slate-500/20 text-slate-300 border border-slate-500/30",
  ACTIVE: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
  RELEASED: "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30",
};

export function VersionTypeBadge({ name }: { name: string | null }) {
  const { t } = useI18n();
  if (!name) {
    return (
      <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {t("version.type.uncategorized")}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeColor(name)}`}
    >
      {name}
    </span>
  );
}

/**
 * Compact tag showing which version a task belongs to. Used on board cards
 * (number only), task drawer, detail page, and archive (number + name).
 */
export function TaskVersionTag({
  number,
  name,
  showName = false,
  className = "",
  title,
}: {
  number: string;
  name?: string | null;
  showName?: boolean;
  className?: string;
  /** Override the native tooltip text (defaults to "number · name") */
  title?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ${className}`}
      title={title ?? (name ? `${number} · ${name}` : number)}
    >
      <Milestone className="h-2.5 w-2.5 shrink-0" />
      <span className="font-mono">{number}</span>
      {showName && name ? <span className="max-w-[140px] truncate">{name}</span> : null}
    </span>
  );
}

export function VersionStatusBadge({
  status,
}: {
  status: "PLANNED" | "ACTIVE" | "RELEASED";
}) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${VERSION_STATUS_COLORS[status]}`}
    >
      {t(`version.status.${status}`)}
    </span>
  );
}
