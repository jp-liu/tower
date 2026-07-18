"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, CheckCircle2, Circle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";
import { checkExtension } from "@/actions/extension-actions";
import { getExtensionMetadata } from "@/lib/extensions/metadata";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

type Gateway = "openclaw" | "hermes";

interface GatewayRuntimeConfig {
  profile?: string;
  displayName?: string;
  env?: Record<string, string>;
}

type GatewayConfigMap = Partial<Record<Gateway, GatewayRuntimeConfig>>;
type GatewayStatusMap = Partial<Record<Gateway, { installed: boolean; version?: string }>>;

interface LegacyTarget {
  gateway?: string;
  profile?: string;
  env?: Record<string, string>;
}

const GATEWAYS: Gateway[] = ["openclaw", "hermes"];
const EXTENSION_BY_GATEWAY = {
  openclaw: "tower-agent-openclaw",
  hermes: "tower-agent-hermes",
} as const;
const CONFIG_KEY = "harness.gatewayConfig";
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function envToText(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function textToEnv(text: string): { env: Record<string, string>; errors: string[] } {
  const env: Record<string, string> = {};
  const errors: string[] = [];
  for (const [idx, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) {
      errors.push(`line ${idx + 1}`);
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (!ENV_KEY_RE.test(key)) {
      errors.push(key || `line ${idx + 1}`);
      continue;
    }
    env[key] = line.slice(eq + 1).trim();
  }
  return { env, errors };
}

function fromLegacyTargets(targets: LegacyTarget[]): GatewayConfigMap {
  const map: GatewayConfigMap = {};
  for (const gateway of GATEWAYS) {
    const legacy = targets.find((target) => target.gateway?.trim().toLowerCase() === gateway && (target.profile || target.env));
    if (!legacy) continue;
    map[gateway] = {
      ...(legacy.profile?.trim() ? { profile: legacy.profile.trim() } : {}),
      ...(legacy.env && Object.keys(legacy.env).length > 0 ? { env: legacy.env } : {}),
    };
  }
  return map;
}

export function GatewayExtensionSettings() {
  const { t } = useI18n();
  const tk = (k: string) => t(k as Parameters<typeof t>[0]);
  const [config, setConfig] = useState<GatewayConfigMap>({});
  const [status, setStatus] = useState<GatewayStatusMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, startSave] = useTransition();
  const [installing, setInstalling] = useState<Gateway | null>(null);
  const [refreshing, setRefreshing] = useState<Gateway | null>(null);

  useEffect(() => {
    Promise.all([
      getConfigValue<GatewayConfigMap>(CONFIG_KEY, {}),
      getConfigValue<LegacyTarget[]>("harness.targets", []),
      checkExtension("tower-agent-openclaw"),
      checkExtension("tower-agent-hermes"),
    ])
      .then(([stored, targets, openclawStatus, hermesStatus]) => {
        const legacy = fromLegacyTargets(Array.isArray(targets) ? targets : []);
        setConfig({
          openclaw: { ...(legacy.openclaw ?? {}), ...(stored.openclaw ?? {}) },
          hermes: { ...(legacy.hermes ?? {}), ...(stored.hermes ?? {}) },
        });
        setStatus({
          openclaw: { installed: openclawStatus.installed, version: openclawStatus.version },
          hermes: { installed: hermesStatus.installed, version: hermesStatus.version },
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const patch = (gateway: Gateway, next: Partial<GatewayRuntimeConfig>) => {
    setConfig((current) => ({
      ...current,
      [gateway]: {
        ...(current[gateway] ?? {}),
        ...next,
      },
    }));
  };

  const save = async (nextConfig = config) => {
    await setConfigValue(CONFIG_KEY, nextConfig);
  };

  const saveWithToast = () => {
    startSave(async () => {
      await save();
      toast.success(t("settings.extensions.gateway.saved"));
    });
  };

  const install = async (gateway: Gateway) => {
    setInstalling(gateway);
    try {
      await save();
      const runtime = config[gateway] ?? {};
      const wasInstalled = status[gateway]?.installed;
      const res = await fetch("/api/internal/harness/gateway-install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gateway,
          profile: runtime.profile?.trim() || undefined,
          displayName: runtime.displayName?.trim() || undefined,
          env: runtime.env && Object.keys(runtime.env).length > 0 ? runtime.env : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; report?: { error?: string } };
      if (!res.ok || !data.ok) {
        toast.error(`${t("settings.extensions.gateway.installFailed")}：${data.error ?? data.report?.error ?? "install failed"}`);
        return;
      }
      const nextStatus = await checkExtension(EXTENSION_BY_GATEWAY[gateway]);
      setStatus((current) => ({
        ...current,
        [gateway]: { installed: nextStatus.installed, version: nextStatus.version },
      }));
      toast.success(wasInstalled ? t("settings.extensions.gateway.updateSuccess") : t("settings.extensions.gateway.installSuccess"));
    } catch (err) {
      toast.error(`${t("settings.extensions.gateway.installFailed")}：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInstalling(null);
    }
  };

  const recheck = async (gateway: Gateway) => {
    setRefreshing(gateway);
    try {
      const nextStatus = await checkExtension(EXTENSION_BY_GATEWAY[gateway]);
      setStatus((current) => ({
        ...current,
        [gateway]: { installed: nextStatus.installed, version: nextStatus.version },
      }));
    } finally {
      setRefreshing(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-muted/50 p-5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="px-1">
        <h3 className="text-sm font-semibold">{t("settings.extensions.gateway.title")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.extensions.gateway.desc")}</p>
      </div>
      <div className="grid gap-3">
        {GATEWAYS.map((gateway) => {
          const runtime = config[gateway] ?? {};
          const extension = getExtensionMetadata(EXTENSION_BY_GATEWAY[gateway]);
          const Icon = extension?.icon;
          const gatewayStatus = status[gateway];
          const isInstalled = Boolean(gatewayStatus?.installed);
          return (
            <div key={gateway} className="rounded-xl border border-border bg-muted/50 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {Icon ? (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold">{extension?.name ?? tk(`settings.harness.gateway.${gateway}`)}</h4>
                    <p className="mt-0.5 text-xs text-muted-foreground">{extension?.description}</p>
                    {extension?.hintKey ? (
                      <p className="mt-1 text-xs text-muted-foreground/80">{t(extension.hintKey)}</p>
                    ) : null}
                  </div>
                </div>
                <span className="shrink-0 rounded-md bg-background px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
                  ~{extension?.sizeMB ?? 1} MB
                </span>
              </div>

              <div className="mt-4 flex items-center gap-2 text-xs">
                {isInstalled ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-foreground">
                      {t("settings.extensions.installed")}
                      {gatewayStatus?.version ? ` v${gatewayStatus.version}` : ""}
                    </span>
                  </>
                ) : (
                  <>
                    <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">{t("settings.extensions.notInstalledShort")}</span>
                  </>
                )}
              </div>

              <div className="mt-4 space-y-3">
                {isInstalled ? (
                  <>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">{t("settings.extensions.gateway.profileLabel")}</label>
                      <Input
                        value={runtime.profile ?? ""}
                        onChange={(e) => patch(gateway, { profile: e.target.value })}
                        placeholder={t("settings.extensions.gateway.profilePlaceholder")}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">{t("settings.extensions.gateway.displayNameLabel")}</label>
                      <Input
                        value={runtime.displayName ?? ""}
                        onChange={(e) => patch(gateway, { displayName: e.target.value })}
                        placeholder={t("settings.extensions.gateway.displayNamePlaceholder")}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">{t("settings.extensions.gateway.envLabel")}</label>
                      <Textarea
                        value={envToText(runtime.env)}
                        onChange={(e) => {
                          const parsed = textToEnv(e.target.value);
                          patch(gateway, { env: parsed.env });
                        }}
                        placeholder={t("settings.extensions.gateway.envPlaceholder")}
                        className="min-h-24 font-mono text-xs"
                      />
                      <p className="text-[11px] text-muted-foreground">{t("settings.extensions.gateway.envHint")}</p>
                    </div>
                  </>
                ) : null}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="default" onClick={() => install(gateway)} disabled={installing === gateway}>
                    {installing === gateway ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {installing === gateway
                      ? t("settings.extensions.gateway.installing")
                      : isInstalled
                        ? t("settings.extensions.gateway.update")
                        : t("settings.extensions.gateway.install")}
                  </Button>
                  {isInstalled ? (
                    <Button variant="ghost" onClick={saveWithToast} disabled={saving || installing !== null}>
                      <Check className="h-3.5 w-3.5" />
                      {t("common.save")}
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => recheck(gateway)} disabled={refreshing === gateway}>
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshing === gateway ? "animate-spin" : ""}`} />
                    {t("settings.extensions.recheck")}
                  </Button>
                  {extension?.homepageUrl ? (
                    <Button variant="ghost" onClick={() => window.open(extension.homepageUrl, "_blank", "noopener,noreferrer")}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t("settings.extensions.visitHomepage")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
