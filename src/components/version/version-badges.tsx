"use client";

import { useI18n } from "@/lib/i18n";

export const VERSION_TYPE_COLORS: Record<
  "FEATURE" | "BUGFIX" | "RESEARCH",
  string
> = {
  FEATURE: "bg-sky-500/20 text-sky-300 border border-sky-500/30",
  BUGFIX: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  RESEARCH: "bg-violet-500/20 text-violet-300 border border-violet-500/30",
};

export const VERSION_STATUS_COLORS: Record<
  "PLANNED" | "ACTIVE" | "RELEASED",
  string
> = {
  PLANNED: "bg-slate-500/20 text-slate-300 border border-slate-500/30",
  ACTIVE: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
  RELEASED: "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30",
};

export function VersionTypeBadge({
  type,
}: {
  type: "FEATURE" | "BUGFIX" | "RESEARCH";
}) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${VERSION_TYPE_COLORS[type]}`}
    >
      {t(`version.type.${type}`)}
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
