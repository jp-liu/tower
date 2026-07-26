"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  Clipboard,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { CliConfigSchema } from "@tower/ai-sdk";
import {
  confirmAndEnableCliPlugin,
  disableCliPlugin,
  enableCliPlugin,
  getCliPluginConnection,
  installCliPlugin,
  listCliPlugins,
  planLocalCliPlugin,
  planNpmCliPlugin,
  recoverCliPluginRegistry,
  reviewInstalledCliPlugin,
  revealCliPluginSecret,
  saveCliPluginConnection,
  testCliPluginConnection,
  uninstallCliPlugin,
} from "@/actions/cli-plugin-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import type {
  CliEnvironmentVariable,
  CliPluginConnectionDetail,
  SafeCliPluginPlan,
} from "@/lib/ai/cli-plugin-service";
import { CLI_SECRET_MASK } from "@/lib/ai/cli-plugin-shared";

type PluginResult = Awaited<ReturnType<typeof listCliPlugins>>;
type Plugin = Extract<PluginResult, { ok: true }>["data"][number];
type InstallSource = "npm" | "local";
const DEFAULT_SENSITIVE_NAME = /(authorization|token|key|secret|password|passwd|credential|cookie)/i;
const CONNECTIONS_CHANGED_EVENT = "tower:provider-connections-changed";

function legacyInstallSource(source: Plugin["source"]): InstallSource | null {
  if (source === "npm") return "npm";
  if (source === "local" || source === "development") return "local";
  return null;
}

function notifyConnectionsChanged() {
  window.dispatchEvent(new Event(CONNECTIONS_CHANGED_EVENT));
}

function actionError(t: (key: never) => string, code?: string) {
  return t(`settings.cliPlugins.error.${code ?? "operation_failed"}` as never);
}

function schemaProperties(schema: CliConfigSchema) {
  return Object.entries(schema.properties ?? {}).sort(([, left], [, right]) =>
    (left["x-tower"]?.order ?? Number.MAX_SAFE_INTEGER)
    - (right["x-tower"]?.order ?? Number.MAX_SAFE_INTEGER));
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function SettingsField({
  name,
  schema,
  value,
  onChange,
  onReveal,
}: {
  name: string;
  schema: CliConfigSchema;
  value: unknown;
  onChange(value: unknown): void;
  onReveal(): Promise<unknown>;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  async function copyValue() {
    try {
      const revealed = value === CLI_SECRET_MASK ? await onReveal() : value;
      await navigator.clipboard.writeText(String(revealed ?? ""));
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("common.copyFailed"));
    }
  }

  async function showValue() {
    try {
      if (value === CLI_SECRET_MASK) await onReveal();
      setVisible(true);
    } catch {
      // The field-level reveal action already surfaced a safe error.
    }
  }
  const control = schema["x-tower"]?.control;
  const sensitive = schema["x-tower"]?.sensitive === true;
  const id = `plugin-setting-${name}`;
  const title = schema.title ?? name;
  const description = schema.description;
  let input: React.ReactNode;

  if (schema.type === "boolean" || control === "switch") {
    input = <Switch id={id} checked={value === true} onCheckedChange={onChange} />;
  } else if (control === "select") {
    const selected = value === undefined ? null : String(value);
    input = (
      <Select value={selected} onValueChange={(next) => {
        const option = schema.enum?.find((candidate) => String(candidate) === next);
        if (option !== undefined) onChange(option);
      }}>
        <SelectTrigger id={id} className="w-full"><span className="truncate">{selected ?? t("settings.cliPlugins.selectValue")}</span></SelectTrigger>
        <SelectContent>{(schema.enum ?? []).map((option) => <SelectItem key={String(option)} value={String(option)}>{String(option)}</SelectItem>)}</SelectContent>
      </Select>
    );
  } else if (control === "multiselect") {
    const selected = new Set(asStringList(value));
    input = (
      <div className="flex flex-wrap gap-3 rounded-md border px-3 py-2">
        {(schema.items?.enum ?? []).map((option) => {
          const text = String(option);
          return (
            <label key={text} className="flex items-center gap-2 text-sm">
              <Checkbox checked={selected.has(text)} onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(text); else next.delete(text);
                onChange([...next]);
              }} />
              {text}
            </label>
          );
        })}
      </div>
    );
  } else if (control === "string-list") {
    input = <Textarea id={id} value={asStringList(value).join("\n")} onChange={(event) => onChange(event.target.value.split(/\r?\n/).filter(Boolean))} />;
  } else if (control === "key-value") {
    const record = typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    input = <Textarea id={id} value={Object.entries(record).map(([key, entry]) => `${key}=${String(entry)}`).join("\n")} onChange={(event) => onChange(Object.fromEntries(event.target.value.split(/\r?\n/).filter(Boolean).map((line) => {
      const separator = line.indexOf("=");
      return separator < 0 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
    })))} />;
  } else {
    input = (
      <div className="flex gap-2">
        <Input
          id={id}
          type={schema.type === "number" || schema.type === "integer" ? "number" : sensitive && !visible ? "password" : "text"}
          value={value === CLI_SECRET_MASK ? "••••••••" : typeof value === "string" || typeof value === "number" ? value : ""}
          readOnly={value === CLI_SECRET_MASK}
          onChange={(event) => onChange(schema.type === "number" || schema.type === "integer" ? Number(event.target.value) : event.target.value)}
          className={control === "path" ? "font-mono" : undefined}
        />
        {sensitive && (
          <>
            <Button type="button" variant="outline" size="icon" aria-label={t(visible ? "settings.aiTools.hideValue" : "settings.aiTools.showValue")} onClick={() => visible ? setVisible(false) : void showValue()}>
              {visible ? <EyeOff /> : <Eye />}
            </Button>
            <Button type="button" variant="outline" size="icon" aria-label={t("common.copy")} onClick={() => void copyValue()}>
              <Clipboard />
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5" data-advanced={schema["x-tower"]?.advanced || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>{title}</Label>
        {schema["x-tower"]?.group && <Badge variant="outline">{schema["x-tower"]?.group}</Badge>}
        {schema["x-tower"]?.advanced && <Badge variant="outline">{t("settings.cliPlugins.advanced")}</Badge>}
      </div>
      {input}
      {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
    </div>
  );
}

export function CliPluginsSection() {
  const { t } = useI18n();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [source, setSource] = useState<InstallSource>("npm");
  const [packageName, setPackageName] = useState("");
  const [version, setVersion] = useState("");
  const [directory, setDirectory] = useState("");
  const [plan, setPlan] = useState<SafeCliPluginPlan | null>(null);
  const [installed, setInstalled] = useState(false);
  const [recoveringConfirmation, setRecoveringConfirmation] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [danger, setDanger] = useState<null | { type: "disable" | "uninstall"; plugin: Plugin }>(null);
  const [detail, setDetail] = useState<CliPluginConnectionDetail | null>(null);
  const [baseArgsText, setBaseArgsText] = useState("");
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [envVars, setEnvVars] = useState<CliEnvironmentVariable[]>([]);
  const [visibleEnv, setVisibleEnv] = useState<Set<string>>(() => new Set());
  const [commandCandidates, setCommandCandidates] = useState<Array<{
    path: string;
    version: string | null;
    state: string;
  }>>([]);

  const load = useCallback(async () => {
    const result = await listCliPlugins();
    if (result.ok) {
      setPlugins(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.error.code);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function resetInstall() {
    setPlan(null);
    setInstalled(false);
    setDialogError(null);
    setRecoveringConfirmation(false);
  }

  async function createPlan() {
    setPending("plan");
    setDialogError(null);
    const result = source === "npm"
      ? await planNpmCliPlugin(packageName, version)
      : await planLocalCliPlugin(directory);
    if (result.ok) setPlan(result.data);
    else setDialogError(actionError(t, result.error.code));
    setPending(null);
  }

  async function install() {
    if (!plan) return;
    setPending("install");
    const result = await installCliPlugin(plan.planDigest);
    if (result.ok) {
      setInstalled(true);
      await load();
      notifyConnectionsChanged();
    } else setDialogError(actionError(t, result.error.code));
    setPending(null);
  }

  async function confirmEnable() {
    if (!plan) return;
    setPending("enable");
    const result = await confirmAndEnableCliPlugin(plan.planDigest);
    if (result.ok) {
      setInstallOpen(false);
      resetInstall();
      await load();
      notifyConnectionsChanged();
      toast.success(t("settings.cliPlugins.enabled"));
    } else setDialogError(actionError(t, result.error.code));
    setPending(null);
  }

  async function performDanger() {
    if (!danger) return;
    const current = danger;
    setDanger(null);
    setPending(`${current.type}:${current.plugin.id}`);
    const result = current.type === "disable"
      ? await disableCliPlugin(current.plugin.id)
      : await uninstallCliPlugin(current.plugin.id);
    if (!result.ok) toast.error(actionError(t, result.error.code));
    else {
      toast.success(t(current.type === "disable" ? "settings.cliPlugins.disabled" : "settings.cliPlugins.uninstalled"));
      await load();
      notifyConnectionsChanged();
    }
    setPending(null);
  }

  async function enablePlugin(pluginId: string) {
    setPending(`enable-existing:${pluginId}`);
    const result = await enableCliPlugin(pluginId);
    if (result.ok) {
      toast.success(t("settings.cliPlugins.enabled"));
      await load();
      notifyConnectionsChanged();
    } else toast.error(actionError(t, result.error.code));
    setPending(null);
  }

  async function reviewInstalled(plugin: Plugin) {
    const source = legacyInstallSource(plugin.source);
    if (!source) {
      toast.error(actionError(t, "invalid_input"));
      return;
    }
    setPending(`review-existing:${plugin.id}`);
    const result = await reviewInstalledCliPlugin(plugin.id);
    if (result.ok) {
      resetInstall();
      setSource(source);
      setRecoveringConfirmation(true);
      setPlan(result.data);
      setInstallOpen(true);
    } else toast.error(actionError(t, result.error.code));
    setPending(null);
  }

  function openLegacyUpdate(plugin: Plugin) {
    const source = legacyInstallSource(plugin.source);
    if (!source) return;
    setSource(source);
    setPackageName(plugin.id);
    resetInstall();
    setInstallOpen(true);
  }

  async function copyEnvValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("common.copyFailed"));
    }
  }

  async function revealSetting(name: string): Promise<unknown> {
    if (!detail) throw new Error("plugin_not_found");
    const result = await revealCliPluginSecret(detail.id, { kind: "setting", key: name });
    if (!result.ok) {
      toast.error(actionError(t, result.error.code));
      throw new Error(result.error.code);
    }
    setSettings((current) => ({ ...current, [name]: result.data.value }));
    return result.data.value;
  }

  async function revealEnvironment(entry: CliEnvironmentVariable): Promise<string> {
    if (!detail) throw new Error("plugin_not_found");
    if (entry.value !== CLI_SECRET_MASK) return entry.value;
    const result = await revealCliPluginSecret(detail.id, { kind: "environment", key: entry.id });
    if (!result.ok) {
      toast.error(actionError(t, result.error.code));
      throw new Error(result.error.code);
    }
    setEnvVars((current) => current.map((candidate) => candidate.id === entry.id
      ? { ...candidate, value: result.data.value }
      : candidate));
    return result.data.value;
  }

  function toggleEnvVisibility(id: string) {
    setVisibleEnv((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function openConfiguration(pluginId: string) {
    setPending(`detail:${pluginId}`);
    const result = await getCliPluginConnection(pluginId);
    if (result.ok) {
      setDetail(result.data);
      setBaseArgsText(result.data.baseArgs.join("\n"));
      setSettings(result.data.settings);
      setEnvVars(result.data.envVars);
      setVisibleEnv(new Set());
      setCommandCandidates([]);
    } else toast.error(actionError(t, result.error.code));
    setPending(null);
  }

  async function saveConfiguration() {
    if (!detail) return;
    setPending("save-config");
    const result = await saveCliPluginConnection({
      connectionId: detail.id,
      name: detail.name,
      enabled: detail.enabled,
      commandOverride: detail.commandOverride,
      baseArgs: baseArgsText.split(/\r?\n/).filter(Boolean),
      envVars,
      settings,
    });
    if (result.ok) {
      setDetail(result.data);
      setSettings(result.data.settings);
      toast.success(t("settings.cliPlugins.configurationSaved"));
      await load();
      notifyConnectionsChanged();
    } else toast.error(actionError(t, result.error.code));
    setPending(null);
  }

  async function testConnection(pluginId: string) {
    setPending(`test:${pluginId}`);
    const result = await testCliPluginConnection(pluginId);
    const candidates = result.ok ? result.data.candidates : [];
    if (result.ok) toast.success(t("settings.cliPlugins.testPassed"));
    else toast.error(actionError(t, result.error.code));
    await load();
    notifyConnectionsChanged();
    if (detail?.pluginId === pluginId) {
      await openConfiguration(pluginId);
      setCommandCandidates(candidates);
    }
    setPending(null);
  }

  async function recover() {
    setPending("recover");
    const result = await recoverCliPluginRegistry();
    if (result.ok) {
      toast.success(t("settings.cliPlugins.registryRecovered"));
      await load();
    } else toast.error(actionError(t, result.error.code));
    setPending(null);
  }

  const canPlan = source === "npm" ? packageName.trim() && version.trim() : directory.trim();
  const schemaFields = useMemo(() => detail ? schemaProperties(detail.configSchema) : [], [detail]);

  return (
    <>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{t("settings.cliPlugins.title")}</h3>
            <p className="text-xs text-muted-foreground">{t("settings.cliPlugins.desc")}</p>
          </div>
          <Button onClick={() => { resetInstall(); setInstallOpen(true); }}><PackagePlus />{t("settings.cliPlugins.add")}</Button>
        </div>
        {loading ? (
          <div className="relative h-24"><Loader2 className="absolute inset-0 m-auto size-5 animate-spin" /></div>
        ) : loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-5 text-sm text-destructive">
            <span>{actionError(t, loadError)}</span>
            <Button variant="outline" onClick={() => void recover()} disabled={pending === "recover"}><RefreshCw />{t("settings.cliPlugins.recover")}</Button>
          </div>
        ) : plugins.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t("settings.cliPlugins.empty")}</p>
        ) : (
          <ul className="divide-y">
            {plugins.map((plugin) => (
              <li key={plugin.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="break-words text-sm font-medium">{plugin.displayName}</span>
                    <Badge variant="outline">{plugin.source}</Badge>
                    <Badge variant={plugin.health === "ready" ? "secondary" : plugin.health === "corrupt" ? "destructive" : "outline"}>{t(`settings.cliPlugins.health.${plugin.health}` as never)}</Badge>
                    {!plugin.permissionConfirmed && <Badge variant="destructive">{t("settings.cliPlugins.permissionPending")}</Badge>}
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{plugin.id} · {plugin.version}</p>
                  <div className="mt-1 flex flex-wrap gap-1">{plugin.permissions.map((permission) => <Badge key={permission} variant="outline">{permission}</Badge>)}</div>
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                  <Button variant="outline" onClick={() => void testConnection(plugin.id)} disabled={!plugin.enabled || pending !== null}>{pending === `test:${plugin.id}` && <Loader2 className="animate-spin" />}<ShieldCheck />{t("settings.aiTools.testConnection")}</Button>
                  <Button variant="outline" onClick={() => void openConfiguration(plugin.id)} disabled={!plugin.enabled || pending !== null}><Pencil />{t("common.edit")}</Button>
                  {plugin.enabled
                    ? <Button variant="outline" onClick={() => setDanger({ type: "disable", plugin })}>{t("settings.cliPlugins.disable")}</Button>
                    : plugin.permissionConfirmed
                      ? <Button variant="outline" onClick={() => void enablePlugin(plugin.id)} disabled={pending !== null}>{pending === `enable-existing:${plugin.id}` && <Loader2 className="animate-spin" />}{t("settings.cliPlugins.enable")}</Button>
                      : <Button variant="outline" onClick={() => void reviewInstalled(plugin)} disabled={pending !== null}>{pending === `review-existing:${plugin.id}` && <Loader2 className="animate-spin" />}{t("settings.cliPlugins.reviewAndEnable")}</Button>}
                  {legacyInstallSource(plugin.source) && <Button variant="outline" onClick={() => openLegacyUpdate(plugin)}><RefreshCw />{t("settings.cliPlugins.update")}</Button>}
                  <Button variant="destructive" onClick={() => setDanger({ type: "uninstall", plugin })}><Trash2 />{t("settings.cliPlugins.uninstall")}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={installOpen} onOpenChange={(open) => { setInstallOpen(open); if (!open) resetInstall(); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("settings.cliPlugins.add")}</DialogTitle>
            <DialogDescription>{t("settings.cliPlugins.installDesc")}</DialogDescription>
          </DialogHeader>
          {!recoveringConfirmation && <Tabs value={source} onValueChange={(value) => {
            if (value === source) return;
            setSource(value as InstallSource);
            resetInstall();
          }}>
            <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="npm">npm</TabsTrigger><TabsTrigger value="local">{t("settings.cliPlugins.local")}</TabsTrigger></TabsList>
          </Tabs>}
          {!recoveringConfirmation && (source === "npm" ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <div className="space-y-1.5"><Label htmlFor="plugin-package">{t("settings.cliPlugins.packageName")}</Label><Input id="plugin-package" value={packageName} onChange={(event) => { setPackageName(event.target.value); resetInstall(); }} placeholder="@scope/tower-cli-provider" /></div>
              <div className="space-y-1.5"><Label htmlFor="plugin-version">{t("settings.cliPlugins.exactVersion")}</Label><Input id="plugin-version" value={version} onChange={(event) => { setVersion(event.target.value); resetInstall(); }} placeholder="1.2.3" /></div>
            </div>
          ) : (
            <div className="space-y-1.5"><Label htmlFor="plugin-directory">{t("settings.cliPlugins.directory")}</Label><div className="flex gap-2"><FolderOpen className="mt-2.5 size-4 shrink-0" /><Input id="plugin-directory" className="font-mono" value={directory} onChange={(event) => { setDirectory(event.target.value); resetInstall(); }} /></div></div>
          ))}
          {!plan ? (
            <Button onClick={() => void createPlan()} disabled={!canPlan || pending !== null}>{pending === "plan" && <Loader2 className="animate-spin" />}{t("settings.cliPlugins.review")}</Button>
          ) : (
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{plan.displayName}</strong><Badge variant="outline">{plan.toVersion}</Badge><Badge variant="outline">{plan.operation}</Badge></div>
              {plan.description && <p className="text-xs text-muted-foreground">{plan.description}</p>}
              <p className="text-xs">{t("settings.cliPlugins.compatibility")}: Tower {plan.compatibility.tower} · Node {plan.compatibility.node}</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(plan.capabilities.integrations ?? {}).filter(([, enabled]) => enabled).map(([name]) => <Badge key={name} variant="outline">{name.toUpperCase()}</Badge>)}
                {plan.capabilities.models && <Badge variant="outline">Models</Badge>}
                <Badge variant="outline">Query</Badge>
              </div>
              <div className="space-y-1 text-xs">
                <p className="font-medium">{t("settings.cliPlugins.permissions")}</p>
                {plan.permissions.requested.map((permission) => <p key={permission} className="font-mono">{permission}{plan.permissions.added.includes(permission) ? ` · ${t("settings.cliPlugins.added")}` : ""}</p>)}
                {plan.permissions.removed.map((permission) => <p key={permission} className="font-mono text-muted-foreground line-through">{permission} · {t("settings.cliPlugins.removed")}</p>)}
              </div>
              {!installed ? <Button onClick={() => void install()} disabled={pending !== null}>{pending === "install" && <Loader2 className="animate-spin" />}{t("settings.cliPlugins.installDisabled")}</Button>
                : <Button onClick={() => void confirmEnable()} disabled={pending !== null}>{pending === "enable" && <Loader2 className="animate-spin" />}<ShieldCheck />{t("settings.cliPlugins.confirmEnable")}</Button>}
            </div>
          )}
          {dialogError && <p className="flex gap-2 text-xs text-destructive" role="alert"><CircleAlert className="size-4 shrink-0" />{dialogError}</p>}
          <DialogFooter><Button variant="outline" onClick={() => setInstallOpen(false)}>{t("common.cancel")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg sm:max-w-2xl">
          <DialogHeader><DialogTitle>{t("settings.cliPlugins.configuration")}</DialogTitle><DialogDescription>{detail?.pluginId}</DialogDescription></DialogHeader>
          {detail && <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="plugin-name">{t("settings.aiTools.connectionName")}</Label><Input id="plugin-name" value={detail.name} onChange={(event) => setDetail({ ...detail, name: event.target.value })} /></div>
              <div className="flex items-end gap-2 pb-2"><Switch id="plugin-enabled" checked={detail.enabled} onCheckedChange={(enabled) => setDetail({ ...detail, enabled })} /><Label htmlFor="plugin-enabled">{t("settings.aiTools.enabledLabel")}</Label></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="plugin-command">{t("settings.cliPlugins.commandOverride")}</Label><Input id="plugin-command" className="font-mono" value={detail.commandOverride ?? ""} onChange={(event) => setDetail({ ...detail, commandOverride: event.target.value || null })} /></div>
            {commandCandidates.length > 0 && <div className="space-y-2"><Label>{t("settings.cliPlugins.commandCandidates")}</Label><div className="grid gap-1">{commandCandidates.map((candidate) => <Button key={candidate.path} type="button" variant="outline" className="h-auto min-w-0 justify-start py-2 text-left" onClick={() => setDetail({ ...detail, commandOverride: candidate.path })}><Check className="shrink-0" /><span className="min-w-0 break-all font-mono text-xs">{candidate.path}</span><span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{candidate.version ?? candidate.state}</span></Button>)}</div></div>}
            <div className="space-y-1.5"><Label htmlFor="plugin-args">{t("settings.cliPlugins.baseArgs")}</Label><Textarea id="plugin-args" className="font-mono" value={baseArgsText} onChange={(event) => setBaseArgsText(event.target.value)} /></div>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label>{t("settings.cliPlugins.environment")}</Label><Button type="button" variant="outline" onClick={() => setEnvVars((current) => [...current, { id: crypto.randomUUID(), name: "", value: "", enabled: true, sensitive: false }])}><Plus />{t("settings.cliPlugins.addVariable")}</Button></div>
              {envVars.map((entry, index) => <div key={entry.id} className="grid gap-2 sm:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_auto_auto_auto_auto]">
                <Input aria-label={t("settings.cliPlugins.variableName")} value={entry.name} onChange={(event) => setEnvVars((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value, sensitive: item.sensitive || DEFAULT_SENSITIVE_NAME.test(event.target.value) } : item))} />
                <Input aria-label={t("settings.cliPlugins.variableValue")} type={entry.sensitive && !visibleEnv.has(entry.id) ? "password" : "text"} value={entry.value === CLI_SECRET_MASK ? "••••••••" : entry.value} readOnly={entry.value === CLI_SECRET_MASK} onChange={(event) => setEnvVars((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} />
                {entry.sensitive && <Button type="button" variant="outline" size="icon" onClick={() => { if (visibleEnv.has(entry.id)) toggleEnvVisibility(entry.id); else void revealEnvironment(entry).then(() => toggleEnvVisibility(entry.id)).catch(() => undefined); }} aria-label={t(visibleEnv.has(entry.id) ? "settings.aiTools.hideValue" : "settings.aiTools.showValue")}>{visibleEnv.has(entry.id) ? <EyeOff /> : <Eye />}</Button>}
                {entry.sensitive && <Button type="button" variant="outline" size="icon" onClick={() => void revealEnvironment(entry).then(copyEnvValue).catch(() => undefined)} aria-label={t("common.copy")}><Clipboard /></Button>}
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Checkbox checked={entry.sensitive} onCheckedChange={(sensitive) => setEnvVars((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, sensitive: sensitive === true } : item))} /><span>{t("settings.cliPlugins.variableSensitive")}</span></label>
                <Switch checked={entry.enabled} onCheckedChange={(enabled) => setEnvVars((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, enabled } : item))} aria-label={t("settings.cliPlugins.variableEnabled")} />
                <Button type="button" variant="ghost" size="icon" onClick={() => setEnvVars((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={t("common.delete")}><X /></Button>
              </div>)}
            </div>
            {schemaFields.length > 0 && <div className="space-y-4 border-t pt-4"><h3 className="text-sm font-medium">{t("settings.cliPlugins.pluginSettings")}</h3>{schemaFields.map(([name, schema]) => <SettingsField key={name} name={name} schema={schema} value={settings[name]} onChange={(value) => setSettings((current) => ({ ...current, [name]: value }))} onReveal={() => revealSetting(name)} />)}</div>}
            {detail.models.length > 0 && <div className="space-y-2 border-t pt-4"><h3 className="text-sm font-medium">{t("settings.cliPlugins.models")}</h3><div className="flex flex-wrap gap-1">{detail.models.map((model) => <Badge key={model} variant="outline">{model}</Badge>)}</div></div>}
            <div className="flex flex-wrap items-center gap-2 border-t pt-4"><Badge variant={detail.testOk ? "secondary" : "outline"}>{t(`settings.aiTools.status.${detail.testStatus}` as never)}</Badge>{detail.resolvedCommand && <span className="break-all font-mono text-[11px] text-muted-foreground">{detail.resolvedCommand} · {detail.resolvedVersion ?? t("settings.aiTools.versionUnknown")}</span>}</div>
          </div>}
          <DialogFooter className="flex-wrap"><Button variant="outline" onClick={() => detail && void testConnection(detail.pluginId)} disabled={pending !== null}>{t("settings.aiTools.testConnection")}</Button><Button onClick={() => void saveConfiguration()} disabled={pending !== null}>{pending === "save-config" && <Loader2 className="animate-spin" />}{t("common.save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={danger !== null} onOpenChange={(open) => { if (!open) setDanger(null); }}>
        <DialogContent className="rounded-lg sm:max-w-md">
          <DialogHeader><DialogTitle>{t(danger?.type === "uninstall" ? "settings.cliPlugins.uninstall" : "settings.cliPlugins.disable")}</DialogTitle><DialogDescription>{t(danger?.type === "uninstall" ? "settings.cliPlugins.uninstallConfirm" : "settings.cliPlugins.disableConfirm")}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDanger(null)}>{t("common.cancel")}</Button><Button variant="destructive" onClick={() => void performDanger()}>{t("settings.cliPlugins.confirm")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
