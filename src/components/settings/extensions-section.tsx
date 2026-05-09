"use client";

import { useI18n } from "@/lib/i18n";
import { listExtensions } from "@/lib/extensions/registry";
import { ExtensionCard } from "./extension-card";

export function ExtensionsSection() {
  const { t } = useI18n();
  const extensions = listExtensions();

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-base font-semibold">{t("settings.extensions.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.extensions.desc")}</p>
      </header>

      <div className="space-y-3">
        {extensions.map((ext) => (
          <ExtensionCard key={ext.id} extension={ext} />
        ))}
      </div>
    </div>
  );
}
