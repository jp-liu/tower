"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, ExternalLink, Loader2, RefreshCw, ShieldCheck, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ExtensionCardShell } from "./extension-card-shell";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";
import { getGatewayChannelAccessList } from "@/actions/gateway-channel-access-actions";
import { checkExtension } from "@/actions/extension-actions";
import type {
  GatewayAdapterExtensionMetadata,
  GatewayId,
  GatewaySettingsCapability,
} from "@/lib/extensions/types";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

type Gateway = GatewayId;

interface GatewayRuntimeConfig {
  profile?: string;
  displayName?: string;
  env?: Record<string, string>;
  accessPolicy?: {
    ownerIds?: Record<string, string[]>;
    trustedChannels?: Record<string, string[]>;
    channelScopes?: Record<string, Record<string, string>>;
  };
}

type GatewayConfigMap = Partial<Record<Gateway, GatewayRuntimeConfig>>;
type GatewayStatusMap = Partial<Record<Gateway, { installed: boolean; version?: string }>>;
type GatewayChannelAccess = Awaited<ReturnType<typeof getGatewayChannelAccessList>>[number];

interface LegacyTarget {
  gateway?: string;
  profile?: string;
  env?: Record<string, string>;
}

const CONFIG_KEY = "harness.gatewayConfig";
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

type GatewaySnapshot = {
  config: GatewayConfigMap;
  status: GatewayStatusMap;
  channelAccess: GatewayChannelAccess[];
};

let gatewaySnapshot: GatewaySnapshot | null = null;
let gatewayRequest: Promise<GatewaySnapshot> | null = null;

export function invalidateGatewaySettingsCache() {
  gatewaySnapshot = null;
  gatewayRequest = null;
}

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

function idMapToText(value: Record<string, string[]> | undefined): string {
  return Object.entries(value ?? {})
    .flatMap(([platform, ids]) => ids.map((id) => `${platform}:${id}`))
    .join("\n");
}

function textToIdMap(text: string): { value: Record<string, string[]>; errors: string[] } {
  const value: Record<string, string[]> = {};
  const errors: string[] = [];
  for (const [idx, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    const platform = separator > 0 ? line.slice(0, separator).trim().toLowerCase() : "";
    const id = separator > 0 ? line.slice(separator + 1).trim() : "";
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(platform) || !id) {
      errors.push(`line ${idx + 1}`);
      continue;
    }
    value[platform] ??= [];
    if (!value[platform].includes(id)) value[platform].push(id);
  }
  return { value, errors };
}

function fromLegacyTargets(
  targets: LegacyTarget[],
  extensions: readonly GatewayAdapterExtensionMetadata[],
): GatewayConfigMap {
  const map: GatewayConfigMap = {};
  for (const { gateway } of extensions) {
    const legacy = targets.find((target) => target.gateway?.trim().toLowerCase() === gateway && (target.profile || target.env));
    if (!legacy) continue;
    map[gateway] = {
      ...(legacy.profile?.trim() ? { profile: legacy.profile.trim() } : {}),
      ...(legacy.env && Object.keys(legacy.env).length > 0 ? { env: legacy.env } : {}),
    };
  }
  return map;
}

function requestGatewaySnapshot(extensions: readonly GatewayAdapterExtensionMetadata[]) {
  gatewayRequest ??= Promise.all([
    getConfigValue<GatewayConfigMap>(CONFIG_KEY, {}),
    getConfigValue<LegacyTarget[]>("harness.targets", []),
    Promise.all(extensions.map(async (extension) => ({
      gateway: extension.gateway,
      status: await checkExtension(extension.id),
    }))),
    getGatewayChannelAccessList(),
  ]).then(([stored, targets, extensionStatuses, channelAccess]) => {
    const legacy = fromLegacyTargets(Array.isArray(targets) ? targets : [], extensions);
    return {
      config: {
        openclaw: { ...(legacy.openclaw ?? {}), ...(stored.openclaw ?? {}) },
        hermes: { ...(legacy.hermes ?? {}), ...(stored.hermes ?? {}) },
      },
      status: Object.fromEntries(extensionStatuses.map(({ gateway, status }) => [
        gateway,
        { installed: status.installed, version: status.version },
      ])) as GatewayStatusMap,
      channelAccess,
    };
  }).finally(() => {
    gatewayRequest = null;
  });
  return gatewayRequest;
}

interface GatewayExtensionSettingsProps {
  extensions: readonly GatewayAdapterExtensionMetadata[];
}

function supports(
  extension: GatewayAdapterExtensionMetadata,
  capability: GatewaySettingsCapability,
): boolean {
  return extension.capabilities.includes(capability);
}

interface ChannelAccessPanelProps {
  items: GatewayChannelAccess[];
  legacyConfigPresent: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

function ChannelAccessPanel({
  items,
  legacyConfigPresent,
  refreshing,
  onRefresh,
}: ChannelAccessPanelProps) {
  const { t } = useI18n();

  return (
    <div>
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">
            {t("settings.extensions.gateway.channelAccessTitle")}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("settings.extensions.gateway.channelAccessHint")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={t("settings.extensions.gateway.channelAccessRefresh")}
          title={t("settings.extensions.gateway.channelAccessRefresh")}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="border-y border-border/80">
        {items.length === 0 ? (
          <p className="py-5 text-center text-xs text-muted-foreground">
            {t("settings.extensions.gateway.channelAccessEmpty")}
          </p>
        ) : items.map((item) => {
          const scopeText = item.scope.mode === "ALL"
            ? t("settings.extensions.gateway.scopeAll")
            : item.scope.mode === "WORKSPACE"
              ? item.workspace?.name ?? t("settings.extensions.gateway.scopeInvalid")
              : item.projects.length > 0
                ? item.projects.map((project) => `${project.workspaceName} / ${project.name}`).join(" · ")
                : t("settings.extensions.gateway.scopeInvalid");
          return (
            <div
              key={item.key}
              className="grid gap-2 border-b border-border/70 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_auto] md:items-center md:gap-4"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">
                  {item.chatName ?? t("settings.extensions.gateway.unnamedChannel")}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={item.chatId}>
                  {item.chatId}
                </p>
              </div>
              <div className="min-w-0">
                <p className={`text-xs ${item.scopeValid ? "text-foreground" : "text-destructive"}`}>
                  {scopeText}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {item.platform} · {new Date(item.updatedAt).toLocaleString()}
                </p>
              </div>
              <div className={`flex items-center gap-1.5 text-xs ${item.status === "AUTHORIZED" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                {item.status === "AUTHORIZED"
                  ? <ShieldCheck className="h-3.5 w-3.5" />
                  : <ShieldX className="h-3.5 w-3.5" />}
                <span>
                  {item.status === "AUTHORIZED"
                    ? t("settings.extensions.gateway.authorized")
                    : t("settings.extensions.gateway.revoked")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {legacyConfigPresent ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("settings.extensions.gateway.legacyAccessMigrated")}
        </p>
      ) : null}
    </div>
  );
}

export function GatewayExtensionSettings({ extensions }: GatewayExtensionSettingsProps) {
  const { t } = useI18n();
  const [config, setConfig] = useState<GatewayConfigMap>(() => gatewaySnapshot?.config ?? {});
  const [status, setStatus] = useState<GatewayStatusMap>(() => gatewaySnapshot?.status ?? {});
  const [channelAccess, setChannelAccess] = useState<GatewayChannelAccess[]>(
    () => gatewaySnapshot?.channelAccess ?? [],
  );
  const [loading, setLoading] = useState(() => gatewaySnapshot === null);
  const [saving, startSave] = useTransition();
  const [installing, setInstalling] = useState<Gateway | null>(null);
  const [refreshing, setRefreshing] = useState<Gateway | null>(null);
  const [accessRefreshing, setAccessRefreshing] = useState(false);

  useEffect(() => {
    if (gatewaySnapshot) return;
    let active = true;
    void requestGatewaySnapshot(extensions)
      .then((snapshot) => {
        gatewaySnapshot = snapshot;
        if (!active) return;
        setConfig(snapshot.config);
        setStatus(snapshot.status);
        setChannelAccess(snapshot.channelAccess);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [extensions]);

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
    gatewaySnapshot = { config: nextConfig, status, channelAccess };
  };

  const updateStatus = (gateway: Gateway, next: { installed: boolean; version?: string }) => {
    setStatus((current) => {
      const updated = { ...current, [gateway]: next };
      gatewaySnapshot = { config, status: updated, channelAccess };
      return updated;
    });
  };

  const saveWithToast = () => {
    startSave(async () => {
      await save();
      toast.success(t("settings.extensions.gateway.saved"));
    });
  };

  const install = async (extension: GatewayAdapterExtensionMetadata) => {
    const { gateway } = extension;
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
          accessPolicy: runtime.accessPolicy,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; report?: { error?: string } };
      if (!res.ok || !data.ok) {
        toast.error(`${t("settings.extensions.gateway.installFailed")}：${data.error ?? data.report?.error ?? "install failed"}`);
        return;
      }
      const nextStatus = await checkExtension(extension.id);
      updateStatus(gateway, { installed: nextStatus.installed, version: nextStatus.version });
      toast.success(wasInstalled ? t("settings.extensions.gateway.updateSuccess") : t("settings.extensions.gateway.installSuccess"));
    } catch (err) {
      toast.error(`${t("settings.extensions.gateway.installFailed")}：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInstalling(null);
    }
  };

  const recheck = async (extension: GatewayAdapterExtensionMetadata) => {
    const { gateway } = extension;
    setRefreshing(gateway);
    try {
      const nextStatus = await checkExtension(extension.id);
      updateStatus(gateway, { installed: nextStatus.installed, version: nextStatus.version });
    } finally {
      setRefreshing(null);
    }
  };

  const refreshChannelAccess = async () => {
    setAccessRefreshing(true);
    try {
      const next = await getGatewayChannelAccessList();
      setChannelAccess(next);
      if (gatewaySnapshot) gatewaySnapshot = { ...gatewaySnapshot, channelAccess: next };
    } finally {
      setAccessRefreshing(false);
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
        {extensions.map((extension) => {
          const { gateway } = extension;
          const runtime = config[gateway] ?? {};
          const gatewayStatus = status[gateway];
          const isInstalled = Boolean(gatewayStatus?.installed);
          const gatewayChannels = channelAccess.filter((item) => item.gateway === gateway);
          return (
            <ExtensionCardShell
              key={extension.id}
              extension={extension}
              installed={isInstalled}
              version={gatewayStatus?.version}
              actions={(
                <>
                  <Button variant="default" onClick={() => install(extension)} disabled={installing === gateway}>
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
                  <Button variant="ghost" onClick={() => recheck(extension)} disabled={refreshing === gateway}>
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshing === gateway ? "animate-spin" : ""}`} />
                    {t("settings.extensions.recheck")}
                  </Button>
                  <Button variant="ghost" onClick={() => window.open(extension.homepageUrl, "_blank", "noopener,noreferrer")}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("settings.extensions.visitHomepage")}
                  </Button>
                </>
              )}
            >
              {isInstalled ? (
                <div className="space-y-3">
                    {supports(extension, "gateway.profile") ? (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">{t("settings.extensions.gateway.profileLabel")}</label>
                        <Input
                          value={runtime.profile ?? ""}
                          onChange={(e) => patch(gateway, { profile: e.target.value })}
                          placeholder={t("settings.extensions.gateway.profilePlaceholder")}
                        />
                      </div>
                    ) : null}

                    {supports(extension, "gateway.display-name") ? (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">{t("settings.extensions.gateway.displayNameLabel")}</label>
                        <Input
                          value={runtime.displayName ?? ""}
                          onChange={(e) => patch(gateway, { displayName: e.target.value })}
                          placeholder={t("settings.extensions.gateway.displayNamePlaceholder")}
                        />
                      </div>
                    ) : null}

                    {supports(extension, "gateway.runtime-env") ? (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">{t("settings.extensions.gateway.envLabel")}</label>
                        <Textarea
                          value={envToText(runtime.env)}
                          onChange={(e) => {
                            const parsed = textToEnv(e.target.value);
                            patch(gateway, { env: parsed.env });
                          }}
                          placeholder={t("settings.extensions.gateway.envPlaceholder")}
                          className="min-h-24 min-w-0 font-mono text-xs leading-4"
                        />
                        <p className="text-[11px] text-muted-foreground">{t("settings.extensions.gateway.envHint")}</p>
                      </div>
                    ) : null}

                    {supports(extension, "gateway.owner-policy") ? (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">
                          {t("settings.extensions.gateway.ownerIdsLabel")}
                        </label>
                        <Textarea
                          value={idMapToText(runtime.accessPolicy?.ownerIds)}
                          onChange={(e) => {
                            const parsed = textToIdMap(e.target.value);
                            patch(gateway, {
                              accessPolicy: {
                                ...(runtime.accessPolicy ?? {}),
                                ownerIds: parsed.value,
                              },
                            });
                          }}
                          placeholder={t("settings.extensions.gateway.ownerIdsPlaceholder")}
                          className="min-h-24 min-w-0 font-mono text-xs leading-4"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          {t("settings.extensions.gateway.ownerIdsHint")}
                        </p>
                      </div>
                    ) : null}

                    {supports(extension, "gateway.channel-access") ? (
                      <ChannelAccessPanel
                        items={gatewayChannels}
                        legacyConfigPresent={Boolean(
                          runtime.accessPolicy?.trustedChannels || runtime.accessPolicy?.channelScopes,
                        )}
                        refreshing={accessRefreshing}
                        onRefresh={refreshChannelAccess}
                      />
                    ) : null}
                </div>
              ) : null}
            </ExtensionCardShell>
          );
        })}
      </div>
    </div>
  );
}
