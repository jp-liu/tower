"use client";

import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { Locale } from "@/lib/i18n";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";

export function GeneralConfig() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [terminalApp, setTerminalApp] = useState("Terminal");
  const [wsPort, setWsPort] = useState(3001);
  const [idleTimeout, setIdleTimeout] = useState(180);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    getConfigValue<string>("terminal.app", "Terminal").then(setTerminalApp);
    getConfigValue<number>("terminal.wsPort", 3001).then(setWsPort);
    getConfigValue<number>("terminal.idleTimeoutSec", 180).then(setIdleTimeout);
  }, []);

  async function handleSaveTerminal() {
    await setConfigValue("terminal.app", terminalApp);
  }

  async function handleSaveWsPort() {
    const port = Math.max(1024, Math.min(65535, wsPort));
    setWsPort(port);
    await setConfigValue("terminal.wsPort", port);
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

        {/* Language section */}
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

        {/* WebSocket port */}
        <div>
          <h3 className="text-sm font-medium">{t("settings.terminal.wsPort")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.terminal.wsPortDesc")}</p>
          <div className="mt-3 flex gap-2">
            <input
              type="number"
              value={wsPort}
              onChange={(e) => setWsPort(Number(e.target.value))}
              onBlur={handleSaveWsPort}
              min={1024}
              max={65535}
              className="h-9 w-32 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
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
