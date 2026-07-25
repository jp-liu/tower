"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CircleAlert,
  CircleDashed,
  Loader2,
  PlugZap,
  TerminalSquare,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { getAvailableProviders } from "@/actions/ai-config-actions";
import {
  getProviderConnections,
  setCliProviderEnabled,
  type ProviderConnectionRow,
} from "@/actions/provider-connection-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import type { ProviderAvailability } from "@/lib/ai/types";
import { ApiConnectionsSection } from "./api-connections-section";

type ProbeResult = {
  ok: boolean;
  checks?: Array<{ name: string; passed: boolean; message: string }>;
  install?: {
    ok: boolean;
    mcp?: { ok?: boolean };
    hooks?: { ok?: boolean };
    skill?: { ok?: boolean };
  };
  error?: string;
};

function StatusIcon({ ok }: { ok: boolean }) {
  return ok
    ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
    : <X className="size-3.5 text-destructive" aria-hidden />;
}

export function ConnectionsSection() {
  const { t } = useI18n();
  const [providers, setProviders] = useState<ProviderAvailability[]>([]);
  const [connections, setConnections] = useState<ProviderConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const [available, persisted] = await Promise.all([
        getAvailableProviders(),
        getProviderConnections(),
      ]);
      setProviders(available);
      setConnections(persisted);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function testProvider(provider: string) {
    if (testing) return;
    setTesting(provider);
    setResults((current) => {
      const next = { ...current };
      delete next[provider];
      return next;
    });
    try {
      const response = await fetch("/api/adapters/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const result = await response.json() as ProbeResult;
      setResults((current) => ({ ...current, [provider]: result }));
      await load();
    } catch {
      setResults((current) => ({
        ...current,
        [provider]: { ok: false, error: t("settings.aiTools.safeTestError") },
      }));
    } finally {
      setTesting(null);
    }
  }

  async function toggleProvider(provider: string, enabled: boolean) {
    setToggling(provider);
    try {
      await setCliProviderEnabled(provider, enabled);
      await load();
      toast.success(t(enabled ? "settings.aiTools.enabled" : "settings.aiTools.disabled"));
    } catch {
      toast.error(t("settings.aiTools.cliEnableRequiresTest"));
    } finally {
      setToggling(null);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="ai-connections-title">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md border bg-muted/40 p-1.5">
          <PlugZap className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 id="ai-connections-title" className="text-sm font-semibold">
            {t("settings.aiTools.connections")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("settings.aiTools.connectionsDesc")}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-medium">{t("settings.aiTools.cliConnections")}</h3>
            <p className="text-xs text-muted-foreground">{t("settings.aiTools.cliConnectionsDesc")}</p>
          </div>
          <Badge variant="outline">CLI</Badge>
        </div>

        {loading ? (
          <div className="relative h-28" aria-label={t("common.loading")}>
            <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-destructive">
            <span>{t("settings.aiTools.loadFailed")}</span>
            <Button variant="outline" onClick={() => void load()}>{t("settings.aiTools.retry")}</Button>
          </div>
        ) : providers.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("settings.aiTools.noCli")}</p>
        ) : (
          <ul className="divide-y">
            {providers.map((provider) => {
              const stored = connections.find((item) => item.provider === provider.name);
              const result = results[provider.name];
              const isTesting = testing === provider.name;
              const enabled = stored?.enabled ?? true;
              const probeOk = result?.ok ?? stored?.testOk ?? false;
              const status = !provider.cli.available
                ? provider.cli.commandState === "found" ? "notExecutable" : "notInstalled"
                : stored?.testStatus ?? "untested";
              return (
                <li key={provider.name} className="px-4 py-3">
                  <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap sm:items-center">
                    <div className="mt-0.5 rounded-md bg-muted p-1.5">
                      <TerminalSquare className="size-4" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="break-words text-sm font-medium">{provider.displayName}</span>
                        <Badge variant="outline">
                          {provider.builtin ? t("label.builtin") : t("settings.aiTools.extension")}
                        </Badge>
                        <Badge variant={probeOk ? "secondary" : "outline"}>
                          {t(`settings.aiTools.status.${status}` as never)}
                        </Badge>
                      </div>
                      <div className="mt-1 grid gap-0.5 text-[11px] text-muted-foreground sm:grid-cols-2">
                        <span className="min-w-0 break-all font-mono" title={provider.cli.commandPath ?? provider.name}>
                          {provider.cli.commandPath ?? provider.name}
                        </span>
                        <span>{provider.cli.version ?? t("settings.aiTools.versionUnknown")}</span>
                      </div>
                    </div>
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={enabled}
                          disabled={toggling === provider.name || !stored}
                          onCheckedChange={(checked) => void toggleProvider(provider.name, checked)}
                          aria-label={`${provider.displayName} ${t("settings.aiTools.enabledLabel")}`}
                        />
                        {enabled ? t("settings.aiTools.enabledLabel") : t("settings.aiTools.disabledLabel")}
                      </label>
                      <Button
                        variant="outline"
                        onClick={() => void testProvider(provider.name)}
                        disabled={isTesting || testing !== null || !provider.cli.available}
                      >
                        {isTesting && <Loader2 className="animate-spin" aria-hidden />}
                        {isTesting ? t("settings.aiTools.testing") : t("settings.aiTools.testConnection")}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {["mcp", "hooks", "skills"].map((integration) => {
                      const ok = integration === "mcp" ? stored?.mcpInstalled
                        : integration === "hooks" ? stored?.hooksInstalled : stored?.skillsInstalled;
                      return (
                        <span key={integration} className="inline-flex items-center gap-1">
                          {stored ? <StatusIcon ok={Boolean(ok)} /> : <CircleDashed className="size-3.5" aria-hidden />}
                          {integration === "skills" ? "Skills" : integration.toUpperCase()}
                        </span>
                      );
                    })}
                    {stored?.testOk && (!stored.mcpInstalled || !stored.hooksInstalled || !stored.skillsInstalled) && (
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                        <CircleAlert className="size-3.5" aria-hidden />
                        {t("settings.aiTools.degraded")}
                      </span>
                    )}
                  </div>

                  {result && (
                    <div className="mt-3 space-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs" aria-live="polite">
                      {result.checks?.map((check) => (
                        <div key={check.name} className="flex min-w-0 items-start gap-2">
                          <StatusIcon ok={check.passed} />
                          <span className="min-w-0 break-words">{check.message}</span>
                        </div>
                      ))}
                      {result.error && <p className="break-words text-destructive">{t("settings.aiTools.safeTestError")}</p>}
                      {result.ok && result.install && !result.install.ok && (
                        <p className="text-amber-700 dark:text-amber-300">{t("settings.aiTools.degraded")}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ApiConnectionsSection />
    </section>
  );
}
