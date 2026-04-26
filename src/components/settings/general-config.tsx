"use client";

import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { Locale } from "@/lib/i18n";
import { getConfigValue, setConfigValue, getAvailableTerminalApps } from "@/actions/config-actions";
import type { DetectedTerminalApp } from "@/lib/platform";

export function GeneralConfig() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const [mounted, setMounted] = useState(false);

  // Terminal app (for "Open in Terminal")
  const [terminalApp, setTerminalApp] = useState("Terminal");
  const [detectedApps, setDetectedApps] = useState<DetectedTerminalApp[]>([]);

  const [idleTimeout, setIdleTimeout] = useState(180);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    getConfigValue<string>("terminal.app", "Terminal").then(setTerminalApp);
    getConfigValue<number>("terminal.idleTimeoutSec", 180).then(setIdleTimeout);
    getAvailableTerminalApps().then(setDetectedApps);
  }, []);

  async function handleSaveTerminalApp() {
    await setConfigValue("terminal.app", terminalApp);
  }

  async function handleSaveIdleTimeout() {
    const sec = Math.max(180, idleTimeout);
    setIdleTimeout(sec);
    await setConfigValue("terminal.idleTimeoutSec", sec);
  }

  const themeOptions = [
    { value: "light", label: t("settings.themeLight") },
    { value: "dark", label: t("settings.themeDark") },
    { value: "system", label: t("settings.themeSystem") },
  ] as const;

  const langOptions = [
    { value: "zh" as Locale, label: "中文" },
    { value: "en" as Locale, label: "English" },
  ] as const;

  const chipClass = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-xs transition-colors ${
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
    }`;

  return (
    <div>
      <h2 className="text-2xl font-bold">{t("settings.general")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.generalDesc")}</p>

      <div className="mt-8 space-y-8">
        {/* Theme */}
        <div>
          <h3 className="text-sm font-medium">{t("settings.theme")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.themeDesc")}</p>
          <div className="mt-3">
            {!mounted ? (
              <div className="inline-flex h-9 rounded-md border border-border bg-muted p-1 gap-1 w-[200px]" />
            ) : (
              <SegmentedControl
                options={themeOptions.map((o) => ({ value: o.value, label: o.label }))}
                value={theme ?? "system"}
                onChange={(v) => setTheme(v)}
              />
            )}
          </div>
        </div>

        {/* Language */}
        <div>
          <h3 className="text-sm font-medium">{t("settings.language")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.languageDesc")}</p>
          <div className="mt-3">
            <SegmentedControl
              options={langOptions.map((o) => ({ value: o.value, label: o.label }))}
              value={locale}
              onChange={(v) => setLocale(v as typeof locale)}
            />
          </div>
        </div>

        {/* Terminal App — for "Open in Terminal" */}
        <div>
          <h3 className="text-sm font-medium">{t("settings.terminal.label")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.terminal.desc")}</p>
          <div className="mt-3 flex flex-col gap-2">
            {detectedApps.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {detectedApps.map((app) => (
                  <button
                    key={app.value}
                    type="button"
                    onClick={() => {
                      setTerminalApp(app.value);
                      void setConfigValue("terminal.app", app.value);
                    }}
                    className={chipClass(terminalApp === app.value)}
                  >
                    {app.name}
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              value={terminalApp}
              onChange={(e) => setTerminalApp(e.target.value)}
              onBlur={handleSaveTerminalApp}
              placeholder={t("settings.terminal.placeholder")}
              className="h-9 w-64 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Idle timeout */}
        <div>
          <h3 className="text-sm font-medium">{t("settings.terminal.idleTimeout")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.terminal.idleTimeoutDesc")}</p>
          <div className="mt-3 flex gap-2">
            <input
              type="number"
              value={idleTimeout}
              onChange={(e) => setIdleTimeout(Number(e.target.value))}
              onBlur={handleSaveIdleTimeout}
              min={180}
              className="h-9 w-32 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
