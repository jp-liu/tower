"use client";

import { useI18n } from "@/lib/i18n";

interface TaskFileChangesProps {
  added: number;
  removed: number;
}

export function TaskFileChanges({ added, removed }: TaskFileChangesProps) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      <span>{t("diff.filesChanged", { count: String(added + removed) })}</span>
      {added > 0 && <span className="text-green-500">+{added}</span>}
      {removed > 0 && <span className="text-red-500">-{removed}</span>}
    </span>
  );
}
