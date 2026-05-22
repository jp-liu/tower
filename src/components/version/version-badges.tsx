"use client";

import { useI18n } from "@/lib/i18n";

export const VERSION_TYPE_COLORS: Record<
  "FEATURE" | "BUGFIX" | "RESEARCH",
  string
> = {
  FEATURE: "bg-blue-50 text-blue-700",
  BUGFIX: "bg-amber-50 text-amber-700",
  RESEARCH: "bg-violet-50 text-violet-700",
};

export const VERSION_STATUS_COLORS: Record<
  "PLANNED" | "ACTIVE" | "RELEASED",
  string
> = {
  PLANNED: "bg-slate-100 text-slate-600",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  RELEASED: "bg-zinc-100 text-zinc-600",
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
