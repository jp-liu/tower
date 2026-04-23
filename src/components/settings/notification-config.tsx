"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";

export function NotificationConfig() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    getConfigValue<boolean>("notification.enabled", true).then(setEnabled);
  }, []);

  async function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    await setConfigValue("notification.enabled", next);
  }

  return (
    <div>
      <h2 className="text-2xl font-bold">{t("settings.notifications.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.notifications.desc")}</p>

      <div className="mt-8 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">{t("settings.notifications.enable")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.notifications.enableDesc")}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={enabled}
            onClick={handleToggle}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
              enabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
