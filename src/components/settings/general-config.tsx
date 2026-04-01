"use client";

import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";

export function GeneralConfig() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [terminalApp, setTerminalApp] = useState("Terminal");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    getConfigValue<string>("terminal.app", "Terminal").then(setTerminalApp);
  }, []);

  async function handleSaveTerminal() {
    await setConfigValue("terminal.app", terminalApp);
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

  return (
    <div>
      <h2 className="text-2xl font-bold">{t("settings.general")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.generalDesc")}</p>

      <div className="mt-8 space-y-8">
        {/* Theme section */}
        <div>
          <h3 className="text-sm font-medium">{t("settings.theme")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.themeDesc")}</p>
          <div className="mt-3">
            {!mounted ? (
              <div className="inline-flex h-9 rounded-md border bg-muted p-1 gap-1 w-[200px]" />
            ) : (
              <div className="inline-flex rounded-md border bg-muted p-1 gap-1">
                {themeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className={`rounded px-3 py-1 text-sm transition-colors ${
                      theme === opt.value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Language section */}
        <div>
          <h3 className="text-sm font-medium">{t("settings.language")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.languageDesc")}</p>
          <div className="mt-3">
            <div className="inline-flex rounded-md border bg-muted p-1 gap-1">
              {langOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLocale(opt.value)}
                  className={`rounded px-3 py-1 text-sm transition-colors ${
                    locale === opt.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Terminal app section — D-09 per PV-05 */}
        <div>
          <h3 className="text-sm font-medium">{t("settings.terminal.label")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.terminal.desc")}</p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={terminalApp}
              onChange={(e) => setTerminalApp(e.target.value)}
              onBlur={handleSaveTerminal}
              placeholder={t("settings.terminal.placeholder")}
              className="h-9 w-48 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
