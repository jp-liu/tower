"use client";

import { useI18n } from "@/lib/i18n";

export function SystemConfig() {
  const { t } = useI18n();
  return (
    <div>
      <h2 className="text-2xl font-bold">{t("settings.config")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.configDesc")}</p>
      <div className="mt-8 rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">{t("settings.config.empty")}</p>
      </div>
    </div>
  );
}
