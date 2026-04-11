"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { getDefaultCliProfile, updateCliProfile } from "@/actions/cli-profile-actions";

type CliProfile = {
  id: string;
  name: string;
  command: string;
  baseArgs: string;
  envVars: string;
};

function parseBaseArgsToText(baseArgs: string): string {
  try {
    const arr: string[] = JSON.parse(baseArgs);
    return Array.isArray(arr) ? arr.join("\n") : "";
  } catch {
    return "";
  }
}

function parseEnvVarsToText(envVars: string): string {
  try {
    const obj: Record<string, string> = JSON.parse(envVars);
    if (typeof obj !== "object" || Array.isArray(obj) || obj === null) return "";
    return Object.entries(obj)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
  } catch {
    return "";
  }
}

export function CliProfileConfig() {
  const { t } = useI18n();
  const [profile, setProfile] = useState<CliProfile | null>(null);
  const [command, setCommand] = useState("");
  const [baseArgsText, setBaseArgsText] = useState("");
  const [envVarsText, setEnvVarsText] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDefaultCliProfile().then((p) => {
      if (p) {
        setProfile(p);
        setCommand(p.command);
        setBaseArgsText(parseBaseArgsToText(p.baseArgs));
        setEnvVarsText(parseEnvVarsToText(p.envVars));
      }
      setLoading(false);
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!profile) return;

    try {
      const baseArgs = JSON.stringify(
        baseArgsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
      );

      const envVarsObj: Record<string, string> = {};
      envVarsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          const idx = line.indexOf("=");
          if (idx > 0) {
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            envVarsObj[key] = val;
          }
        });
      const envVars = JSON.stringify(envVarsObj);

      await updateCliProfile(profile.id, { command, baseArgs, envVars });
      setSaveStatus(t("settings.cliProfile.saved"));
    } catch {
      setSaveStatus(t("settings.cliProfile.saveError"));
    }

    setTimeout(() => setSaveStatus(""), 2000);
  }, [profile, command, baseArgsText, envVarsText, t]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">...</div>;
  }

  if (!profile) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("settings.cliProfile.noProfile")}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold">{t("settings.cliProfile.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.cliProfile.desc")}</p>

      <div className="mt-8 space-y-8">
        {/* Command section */}
        <div>
          <h3 className="text-sm font-medium">{t("settings.cliProfile.command")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.cliProfile.commandHint")}</p>
          <div className="mt-3">
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t("settings.cliProfile.commandPlaceholder")}
              className="h-9 w-64 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Base args section */}
        <div>
          <h3 className="text-sm font-medium">{t("settings.cliProfile.baseArgs")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.cliProfile.baseArgsHint")}</p>
          <div className="mt-3">
            <textarea
              value={baseArgsText}
              onChange={(e) => setBaseArgsText(e.target.value)}
              placeholder={t("settings.cliProfile.baseArgsPlaceholder")}
              rows={4}
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Env vars section */}
        <div>
          <h3 className="text-sm font-medium">{t("settings.cliProfile.envVars")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.cliProfile.envVarsHint")}</p>
          <div className="mt-3">
            <textarea
              value={envVarsText}
              onChange={(e) => setEnvVarsText(e.target.value)}
              placeholder={t("settings.cliProfile.envVarsPlaceholder")}
              rows={4}
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Save button */}
        <div>
          <button
            onClick={handleSave}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("common.save")}
          </button>
          {saveStatus && (
            <span className="ml-3 text-sm text-muted-foreground">{saveStatus}</span>
          )}
        </div>
      </div>
    </div>
  );
}
