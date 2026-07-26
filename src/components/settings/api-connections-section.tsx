"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsUpDown,
  Clipboard,
  DatabaseZap,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  addApiKey,
  addManualApiModel,
  createApiConnection,
  deleteApiConnection,
  deleteApiKey,
  listApiConnectionPresets,
  listApiConnections,
  refreshApiModels,
  removeManualApiModel,
  reorderApiKeys,
  setApiConnectionEnabled,
  testApiConnection,
  testApiKey,
  updateApiConnection,
  updateApiKey,
} from "@/actions/api-connection-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

type ApiListResult = Awaited<ReturnType<typeof listApiConnections>>;
type ApiConnection = Extract<ApiListResult, { ok: true }>["data"][number];
type ApiKey = ApiConnection["apiKeys"][number];
type ApiModel = ApiConnection["models"][number];
type Preset = Awaited<ReturnType<typeof listApiConnectionPresets>>["presets"][number];
type Protocol = "openai" | "openai-compatible" | "anthropic" | "google";
type ConfigEntry = { id: string; name: string; value: string; enabled: boolean; sensitive: boolean };
type Draft = {
  name: string;
  protocol: Protocol;
  presetId: string | null;
  baseUrl: string;
  defaultModelId: string;
  enabled: boolean;
  headers: ConfigEntry[];
  queryParams: ConfigEntry[];
};

const CUSTOM_PRESET = "__custom__";
const SENSITIVE_NAME = /(authorization|token|key|secret|cookie)/i;

const EMPTY_DRAFT: Draft = {
  name: "",
  protocol: "openai-compatible",
  presetId: null,
  baseUrl: "",
  defaultModelId: "",
  enabled: true,
  headers: [],
  queryParams: [],
};

function IconButton({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={label} {...props} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function stateKey(scope: string, id?: string) {
  return id ? `${scope}:${id}` : scope;
}

export function ApiConnectionsSection() {
  const { t } = useI18n();
  const [connections, setConnections] = useState<ApiConnection[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [tab, setTab] = useState("details");
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [manualModel, setManualModel] = useState("");
  const [confirm, setConfirm] = useState<null | {
    title: string;
    description: string;
    action: () => Promise<void>;
  }>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);

  const current = useMemo(
    () => connections.find((connection) => connection.id === editingId) ?? null,
    [connections, editingId],
  );

  const load = useCallback(async (keepId?: string | null) => {
    setLoadError(false);
    const [connectionResult, presetResult] = await Promise.all([
      listApiConnections(),
      listApiConnectionPresets(),
    ]);
    if (!connectionResult.ok) {
      setLoadError(true);
    } else {
      setConnections(connectionResult.data);
      const id = keepId ?? editingId;
      if (id && !connectionResult.data.some((item) => item.id === id)) setEditingId(null);
    }
    setPresets([...presetResult.presets]);
    setLoading(false);
  }, [editingId]);

  useEffect(() => { void load(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function markPending(key: string, value: boolean) {
    setPending((currentState) => ({ ...currentState, [key]: value }));
  }

  function errorText(code?: string) {
    if (code === "connection_in_use") return t("settings.aiTools.error.connectionInUse");
    if (code === "model_in_use") return t("settings.aiTools.error.modelInUse");
    if (code === "forbidden_header") return t("settings.aiTools.error.forbiddenHeader");
    return t("settings.aiTools.error.operationFailed");
  }

  function openCreate() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setInlineError(null);
    setTab("details");
    setPresetOpen(false);
    setDialogOpen(true);
  }

  function openEdit(connection: ApiConnection) {
    setEditingId(connection.id);
    setDraft({
      name: connection.name,
      protocol: connection.provider as Protocol,
      presetId: connection.presetId,
      baseUrl: connection.baseUrl ?? "",
      defaultModelId: connection.defaultModelId ?? "",
      enabled: connection.enabled,
      headers: connection.headers,
      queryParams: connection.queryParams,
    });
    setInlineError(null);
    setNewKeyOpen(false);
    setEditingKey(null);
    setTab("details");
    setPresetOpen(false);
    setDialogOpen(true);
  }

  function applyPreset(value: string | null) {
    setPresetOpen(false);
    if (!value || value === CUSTOM_PRESET) {
      setDraft((currentDraft) => ({ ...currentDraft, presetId: null }));
      return;
    }
    const preset = presets.find((item) => item.id === value);
    if (!preset) return;
    setDraft((currentDraft) => ({
      ...currentDraft,
      name: currentDraft.name || preset.name,
      protocol: preset.protocol,
      presetId: preset.id,
      baseUrl: preset.baseUrl,
    }));
  }

  async function saveConnection() {
    const key = stateKey("save", editingId ?? "new");
    if (pending[key]) return;
    markPending(key, true);
    setInlineError(null);
    const input = { ...draft };
    try {
      const result = editingId
        ? await updateApiConnection(editingId, input)
        : await createApiConnection(input);
      if (!result.ok) {
        setInlineError(errorText(result.error.code));
        return;
      }
      setEditingId(result.data.id);
      setDraft({
        name: result.data.name,
        protocol: result.data.provider as Protocol,
        presetId: result.data.presetId,
        baseUrl: result.data.baseUrl ?? "",
        defaultModelId: result.data.defaultModelId ?? "",
        enabled: result.data.enabled,
        headers: result.data.headers,
        queryParams: result.data.queryParams,
      });
      await load(result.data.id);
      toast.success(t("settings.aiTools.connectionSaved"));
    } finally {
      markPending(key, false);
    }
  }

  async function toggleConnection(connection: ApiConnection, enabled: boolean) {
    const key = stateKey("toggle", connection.id);
    markPending(key, true);
    const result = await setApiConnectionEnabled(connection.id, enabled);
    if (!result.ok) toast.error(errorText(result.error.code));
    await load(connection.id);
    markPending(key, false);
  }

  function requestDeleteConnection(connection: ApiConnection) {
    setConfirm({
      title: t("settings.aiTools.deleteConnection"),
      description: t("settings.aiTools.deleteConnectionConfirm"),
      action: async () => {
        const key = stateKey("delete-connection", connection.id);
        markPending(key, true);
        const result = await deleteApiConnection(connection.id);
        markPending(key, false);
        if (!result.ok) {
          setInlineError(errorText(result.error.code));
          toast.error(errorText(result.error.code));
          return;
        }
        setDialogOpen(false);
        await load(null);
        toast.success(t("settings.aiTools.connectionDeleted"));
      },
    });
  }

  function updateEntries(kind: "headers" | "queryParams", entries: ConfigEntry[]) {
    setDraft((currentDraft) => ({ ...currentDraft, [kind]: entries }));
  }

  function addEntry(kind: "headers" | "queryParams") {
    updateEntries(kind, [
      ...draft[kind],
      { id: crypto.randomUUID(), name: "", value: "", enabled: true, sensitive: false },
    ]);
  }

  function patchEntry(kind: "headers" | "queryParams", id: string, patch: Partial<ConfigEntry>) {
    updateEntries(kind, draft[kind].map((entry) => {
      if (entry.id !== id) return entry;
      const next = { ...entry, ...patch };
      if (patch.name !== undefined && SENSITIVE_NAME.test(patch.name)) next.sensitive = true;
      return next;
    }));
  }

  async function addKey() {
    if (!editingId || !newKeyValue) return;
    const key = stateKey("add-key", editingId);
    markPending(key, true);
    const result = await addApiKey(editingId, {
      label: newKeyLabel || null,
      value: newKeyValue,
      enabled: true,
    });
    setNewKeyValue("");
    if (result.ok) {
      setNewKeyLabel("");
      setNewKeyOpen(false);
      await load(editingId);
      toast.success(t("settings.aiTools.keyAdded"));
    } else {
      toast.error(errorText(result.error.code));
    }
    markPending(key, false);
  }

  async function saveKey() {
    if (!editingId || !editingKey) return;
    const key = stateKey("save-key", editingKey.id);
    markPending(key, true);
    const result = await updateApiKey(editingId, editingKey.id, {
      label: editingKey.label,
      value: editingKey.value,
      enabled: editingKey.enabled,
    });
    if (result.ok) {
      setEditingKey(null);
      await load(editingId);
    } else toast.error(errorText(result.error.code));
    markPending(key, false);
  }

  async function toggleKey(apiKey: ApiKey, enabled: boolean) {
    if (!editingId) return;
    const key = stateKey("toggle-key", apiKey.id);
    markPending(key, true);
    const result = await updateApiKey(editingId, apiKey.id, { enabled });
    if (!result.ok) toast.error(errorText(result.error.code));
    await load(editingId);
    markPending(key, false);
  }

  async function moveKey(index: number, direction: -1 | 1) {
    if (!editingId || !current) return;
    const target = index + direction;
    if (target < 0 || target >= current.apiKeys.length) return;
    const ids = current.apiKeys.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const key = stateKey("reorder-keys", editingId);
    markPending(key, true);
    const result = await reorderApiKeys(editingId, ids);
    if (!result.ok) toast.error(errorText(result.error.code));
    await load(editingId);
    markPending(key, false);
  }

  function requestDeleteKey(apiKey: ApiKey) {
    if (!editingId) return;
    setConfirm({
      title: t("settings.aiTools.deleteKey"),
      description: t("settings.aiTools.deleteKeyConfirm"),
      action: async () => {
        const result = await deleteApiKey(editingId, apiKey.id);
        if (!result.ok) toast.error(errorText(result.error.code));
        else await load(editingId);
      },
    });
  }

  async function testOneKey(keyId: string | null) {
    if (!editingId) return;
    const key = stateKey("test-key", keyId ?? "anonymous");
    markPending(key, true);
    const result = await testApiKey(editingId, keyId, draft.defaultModelId || undefined);
    if (!result.ok || !result.data.ok) toast.error(t("settings.aiTools.safeTestError"));
    else toast.success(t("settings.aiTools.testPassed"));
    await load(editingId);
    markPending(key, false);
  }

  async function testWholeConnection() {
    if (!editingId) return;
    const key = stateKey("test-connection", editingId);
    markPending(key, true);
    const result = await testApiConnection(editingId, draft.defaultModelId || undefined);
    if (!result.ok || result.data.some((item) => !item.ok)) {
      toast.error(t("settings.aiTools.safeTestError"));
    } else toast.success(t("settings.aiTools.testPassed"));
    await load(editingId);
    markPending(key, false);
  }

  async function refreshModels() {
    if (!editingId) return;
    const key = stateKey("refresh-models", editingId);
    markPending(key, true);
    const result = await refreshApiModels(editingId);
    if (!result.ok || !result.data.ok) toast.error(t("settings.aiTools.modelRefreshFailed"));
    else toast.success(t("settings.aiTools.modelsRefreshed"));
    await load(editingId);
    markPending(key, false);
  }

  async function addModel() {
    if (!editingId || !manualModel.trim()) return;
    const key = stateKey("add-model", editingId);
    markPending(key, true);
    const result = await addManualApiModel(editingId, manualModel);
    if (result.ok) {
      setManualModel("");
      await load(editingId);
    } else toast.error(errorText(result.error.code));
    markPending(key, false);
  }

  function requestDeleteModel(model: ApiModel) {
    if (!editingId) return;
    setConfirm({
      title: t("settings.aiTools.deleteModel"),
      description: t("settings.aiTools.deleteModelConfirm"),
      action: async () => {
        const result = await removeManualApiModel(editingId, model.modelId);
        if (!result.ok) {
          const message = errorText(result.error.code);
          setInlineError(message);
          toast.error(message);
        } else await load(editingId);
      },
    });
  }

  async function copySecret(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("common.copyFailed"));
    }
  }

  function toggleVisible(id: string) {
    setVisible((currentSet) => {
      const next = new Set(currentSet);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function renderEntries(kind: "headers" | "queryParams") {
    const entries = draft[kind];
    const prefix = kind === "headers" ? "header" : "query";
    return (
      <div className="space-y-2">
        {entries.length === 0 && (
          <p className="py-2 text-xs text-muted-foreground">{t("settings.aiTools.noAdvancedEntries")}</p>
        )}
        {entries.map((entry) => {
          const secretId = `${prefix}:${entry.id}`;
          return (
            <div key={entry.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-2 border-b pb-2 sm:grid-cols-[auto_minmax(8rem,.8fr)_minmax(10rem,1fr)_auto]">
              <Switch
                checked={entry.enabled}
                onCheckedChange={(checked) => patchEntry(kind, entry.id, { enabled: checked })}
                aria-label={t("settings.aiTools.entryEnabled")}
                className="mt-2"
              />
              <Input
                value={entry.name}
                onChange={(event) => patchEntry(kind, entry.id, { name: event.target.value })}
                placeholder={t("settings.aiTools.parameterName")}
                aria-label={t("settings.aiTools.parameterName")}
              />
              <div className="col-span-2 flex min-w-0 gap-1 sm:col-span-1">
                <Input
                  type="text"
                  value={entry.sensitive && !visible.has(secretId) ? "••••••••" : entry.value}
                  onChange={(event) => patchEntry(kind, entry.id, { value: event.target.value })}
                  readOnly={entry.sensitive && !visible.has(secretId)}
                  placeholder={t("settings.aiTools.parameterValue")}
                  aria-label={t("settings.aiTools.parameterValue")}
                  className="min-w-0"
                />
                {entry.sensitive && (
                  <IconButton label={visible.has(secretId) ? t("settings.aiTools.hideValue") : t("settings.aiTools.showValue")} onClick={() => toggleVisible(secretId)}>
                    {visible.has(secretId) ? <EyeOff /> : <Eye />}
                  </IconButton>
                )}
              </div>
              <IconButton label={t("common.delete")} onClick={() => updateEntries(kind, entries.filter((item) => item.id !== entry.id))}>
                <Trash2 />
              </IconButton>
            </div>
          );
        })}
        <Button type="button" variant="outline" onClick={() => addEntry(kind)}>
          <Plus /> {t("settings.aiTools.addParameter")}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-medium">{t("settings.aiTools.apiConnections")}</h3>
            <p className="text-xs text-muted-foreground">{t("settings.aiTools.apiConnectionsDesc")}</p>
          </div>
          <Button onClick={openCreate}><Plus />{t("settings.aiTools.addConnection")}</Button>
        </div>

        {loading ? (
          <div className="relative h-28" aria-label={t("common.loading")}>
            <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-destructive">
            <span>{t("settings.aiTools.loadFailed")}</span>
            <Button variant="outline" onClick={() => void load(null)}>{t("settings.aiTools.retry")}</Button>
          </div>
        ) : connections.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <DatabaseZap className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t("settings.aiTools.noApiConnections")}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {connections.map((connection) => (
              <li key={connection.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="max-w-full break-words text-sm font-medium">{connection.name}</span>
                    <Badge variant="outline">API</Badge>
                    <Badge variant={connection.testOk ? "secondary" : "outline"}>
                      {t(`settings.aiTools.status.${connection.testStatus}` as never)}
                    </Badge>
                    {!connection.enabled && <Badge variant="destructive">{t("settings.aiTools.disabledLabel")}</Badge>}
                  </div>
                  <p className="mt-1 min-w-0 break-all font-mono text-[11px] text-muted-foreground">
                    {connection.provider} · {connection.baseUrl}
                  </p>
                  <p className="mt-0.5 min-w-0 break-all text-[11px] text-muted-foreground">
                    {connection.defaultModelId || t("settings.aiTools.noDefaultModel")} · {connection.apiKeys.length} {t("settings.aiTools.keys")}
                  </p>
                </div>
                <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                  <Switch
                    checked={connection.enabled}
                    disabled={pending[stateKey("toggle", connection.id)]}
                    onCheckedChange={(checked) => void toggleConnection(connection, checked)}
                    aria-label={`${connection.name} ${t("settings.aiTools.enabledLabel")}`}
                  />
                  <Button variant="outline" onClick={() => openEdit(connection)}><Pencil />{t("common.edit")}</Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("settings.aiTools.moreActions")} />}>
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => { openEdit(connection); setTab("keys"); }}>
                        <KeyRound />{t("settings.aiTools.keys")}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => requestDeleteConnection(connection)}>
                        <Trash2 />{t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[min(780px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-4xl">
          <DialogHeader className="shrink-0 border-b px-4 pt-4 pb-3">
            <DialogTitle>{editingId ? t("settings.aiTools.editConnection") : t("settings.aiTools.addConnection")}</DialogTitle>
            <DialogDescription>{t("settings.aiTools.connectionDialogDesc")}</DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(value) => setTab(value ?? "details")} className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
            <TabsList variant="line" className="mx-4 grid h-10 w-[calc(100%-2rem)] shrink-0 grid-cols-3 overflow-hidden">
              <TabsTrigger value="details">{t("settings.aiTools.details")}</TabsTrigger>
              <TabsTrigger value="keys" disabled={!editingId}>{t("settings.aiTools.keys")}</TabsTrigger>
              <TabsTrigger value="models" disabled={!editingId}>{t("settings.aiTools.models")}</TabsTrigger>
            </TabsList>

            <div className="no-scrollbar min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 py-4">
              <TabsContent value="details" className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="api-preset">{t("settings.aiTools.preset")}</Label>
                    <Popover open={presetOpen} onOpenChange={setPresetOpen}>
                      <PopoverTrigger
                        render={
                          <Button
                            id="api-preset"
                            type="button"
                            variant="outline"
                            role="combobox"
                            aria-expanded={presetOpen}
                            className="w-full justify-between font-normal"
                          />
                        }
                      >
                        <span className="truncate">
                          {draft.presetId ? presets.find((item) => item.id === draft.presetId)?.name : t("settings.aiTools.customCompatible")}
                        </span>
                        <ChevronsUpDown className="shrink-0 text-muted-foreground" />
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-[min(40rem,calc(100vw-3rem))] p-0">
                        <Command>
                          <CommandInput placeholder={t("settings.aiTools.presetSearch")} />
                          <CommandList>
                            <CommandEmpty>{t("settings.aiTools.presetNoResults")}</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                value={`${CUSTOM_PRESET} ${t("settings.aiTools.customCompatible")}`}
                                data-checked={!draft.presetId}
                                onSelect={() => applyPreset(CUSTOM_PRESET)}
                              >
                                {t("settings.aiTools.customCompatible")}
                              </CommandItem>
                              {presets.map((preset) => (
                                <CommandItem
                                  key={preset.id}
                                  value={`${preset.name} ${preset.id} ${preset.protocol}`}
                                  data-checked={draft.presetId === preset.id}
                                  onSelect={() => applyPreset(preset.id)}
                                >
                                  <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                                  <span className="shrink-0 text-xs text-muted-foreground">{preset.protocol}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="api-name">{t("settings.aiTools.connectionName")}</Label>
                    <Input id="api-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="api-protocol">{t("settings.aiTools.protocol")}</Label>
                    <Select value={draft.protocol} onValueChange={(value) => value && setDraft({ ...draft, protocol: value as Protocol })}>
                      <SelectTrigger id="api-protocol" className="w-full"><span className="truncate">{draft.protocol}</span></SelectTrigger>
                      <SelectContent>
                        {["openai", "openai-compatible", "anthropic", "google"].map((protocol) => (
                          <SelectItem key={protocol} value={protocol}>{protocol}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="api-base-url">{t("settings.aiTools.baseUrl")}</Label>
                    <Input id="api-base-url" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="http://127.0.0.1:11434/v1" className="font-mono" required />
                    <p className="break-words text-[11px] text-muted-foreground">{t("settings.aiTools.baseUrlHint")}</p>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="api-default-model">{t("settings.aiTools.defaultModel")}</Label>
                    <Input id="api-default-model" value={draft.defaultModelId} onChange={(event) => setDraft({ ...draft, defaultModelId: event.target.value })} className="font-mono" />
                  </div>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <Switch checked={draft.enabled} onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })} />
                    {t("settings.aiTools.enabledLabel")}
                  </label>
                </div>

                <div className="border-t pt-4">
                  <h4 className="text-sm font-medium">{t("settings.aiTools.advanced")}</h4>
                  <p className="mb-3 text-xs text-muted-foreground">{t("settings.aiTools.advancedDesc")}</p>
                  <div className="space-y-4">
                    <div>
                      <h5 className="mb-2 text-xs font-medium">Headers</h5>
                      {renderEntries("headers")}
                    </div>
                    <div>
                      <h5 className="mb-2 text-xs font-medium">Query Parameters</h5>
                      {renderEntries("queryParams")}
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="keys" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-medium">{t("settings.aiTools.keys")}</h4>
                    <p className="text-xs text-muted-foreground">{t("settings.aiTools.keysDesc")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => void testWholeConnection()} disabled={pending[stateKey("test-connection", editingId ?? "")]}>
                      {pending[stateKey("test-connection", editingId ?? "")] && <Loader2 className="animate-spin" />}
                      {t("settings.aiTools.testAllKeys")}
                    </Button>
                    <Button onClick={() => setNewKeyOpen(true)}><Plus />{t("settings.aiTools.addKey")}</Button>
                  </div>
                </div>

                {newKeyOpen && (
                  <div className="grid gap-2 border-y bg-muted/20 py-3 sm:grid-cols-[minmax(8rem,.6fr)_minmax(12rem,1fr)_auto]">
                    <Input value={newKeyLabel} onChange={(event) => setNewKeyLabel(event.target.value)} placeholder={t("settings.aiTools.keyLabel")} aria-label={t("settings.aiTools.keyLabel")} />
                    <Input type={visible.has("new-key") ? "text" : "password"} value={newKeyValue} onChange={(event) => setNewKeyValue(event.target.value)} placeholder={t("settings.aiTools.keyValue")} aria-label={t("settings.aiTools.keyValue")} />
                    <div className="flex gap-1">
                      <IconButton label={visible.has("new-key") ? t("settings.aiTools.hideValue") : t("settings.aiTools.showValue")} onClick={() => toggleVisible("new-key")}>{visible.has("new-key") ? <EyeOff /> : <Eye />}</IconButton>
                      <Button onClick={() => void addKey()} disabled={!newKeyValue || pending[stateKey("add-key", editingId ?? "")]}>{t("common.save")}</Button>
                      <IconButton label={t("common.cancel")} onClick={() => { setNewKeyOpen(false); setNewKeyValue(""); }}><X /></IconButton>
                    </div>
                  </div>
                )}

                {current?.apiKeys.length === 0 ? (
                  <div className="border-y py-6 text-center text-sm text-muted-foreground">
                    <p>{t("settings.aiTools.anonymousConnection")}</p>
                    <Button className="mt-3" variant="outline" onClick={() => void testOneKey(null)} disabled={pending[stateKey("test-key", "anonymous")] }>
                      {t("settings.aiTools.testAnonymous")}
                    </Button>
                  </div>
                ) : (
                  <ul className="divide-y border-y">
                    {current?.apiKeys.map((apiKey, index) => {
                      const secretId = `key:${apiKey.id}`;
                      const edit = editingKey?.id === apiKey.id ? editingKey : null;
                      return (
                        <li key={apiKey.id} className="py-3">
                          {edit ? (
                            <div className="grid gap-2 sm:grid-cols-[minmax(8rem,.6fr)_minmax(12rem,1fr)_auto]">
                              <Input value={edit.label ?? ""} onChange={(event) => setEditingKey({ ...edit, label: event.target.value })} aria-label={t("settings.aiTools.keyLabel")} />
                              <Input type={visible.has(secretId) ? "text" : "password"} value={edit.value} onChange={(event) => setEditingKey({ ...edit, value: event.target.value })} aria-label={t("settings.aiTools.keyValue")} />
                              <div className="flex gap-1">
                                <IconButton label={visible.has(secretId) ? t("settings.aiTools.hideValue") : t("settings.aiTools.showValue")} onClick={() => toggleVisible(secretId)}>{visible.has(secretId) ? <EyeOff /> : <Eye />}</IconButton>
                                <Button onClick={() => void saveKey()} disabled={pending[stateKey("save-key", apiKey.id)]}>{t("common.save")}</Button>
                                <IconButton label={t("common.cancel")} onClick={() => setEditingKey(null)}><X /></IconButton>
                              </div>
                            </div>
                          ) : (
                            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
                              <Switch checked={apiKey.enabled} onCheckedChange={(checked) => void toggleKey(apiKey, checked)} aria-label={`${apiKey.label ?? t("settings.aiTools.unnamedKey")} ${t("settings.aiTools.enabledLabel")}`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="break-words text-sm font-medium">{apiKey.label || t("settings.aiTools.unnamedKey")}</span>
                                  <Badge variant={apiKey.testStatus === "ok" ? "secondary" : apiKey.testStatus === "failed" ? "destructive" : "outline"}>
                                    {t(`settings.aiTools.status.${apiKey.testStatus}` as never)}
                                  </Badge>
                                </div>
                                {visible.has(secretId) ? (
                                  <input className="mt-1 max-w-full border-0 bg-transparent p-0 font-mono text-[11px] text-muted-foreground outline-none" type="text" value={apiKey.value} readOnly aria-label={t("settings.aiTools.maskedKey")} />
                                ) : (
                                  <span className="mt-1 block font-mono text-[11px] text-muted-foreground" aria-label={t("settings.aiTools.maskedKey")}>••••••••••••</span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                <IconButton label={visible.has(secretId) ? t("settings.aiTools.hideValue") : t("settings.aiTools.showValue")} onClick={() => toggleVisible(secretId)}>{visible.has(secretId) ? <EyeOff /> : <Eye />}</IconButton>
                                <IconButton label={t("common.copy")} onClick={() => void copySecret(apiKey.value)}><Clipboard /></IconButton>
                                <IconButton label={t("common.edit")} onClick={() => setEditingKey({ ...apiKey })}><Pencil /></IconButton>
                                <IconButton label={t("settings.aiTools.moveUp")} disabled={index === 0} onClick={() => void moveKey(index, -1)}><ArrowUp /></IconButton>
                                <IconButton label={t("settings.aiTools.moveDown")} disabled={index === (current?.apiKeys.length ?? 0) - 1} onClick={() => void moveKey(index, 1)}><ArrowDown /></IconButton>
                                <IconButton label={t("settings.aiTools.testKey")} disabled={pending[stateKey("test-key", apiKey.id)]} onClick={() => void testOneKey(apiKey.id)}>{pending[stateKey("test-key", apiKey.id)] ? <Loader2 className="animate-spin" /> : <Check />}</IconButton>
                                <IconButton label={t("common.delete")} onClick={() => requestDeleteKey(apiKey)}><Trash2 /></IconButton>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="models" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-medium">{t("settings.aiTools.models")}</h4>
                    <p className="text-xs text-muted-foreground">{t("settings.aiTools.modelsDesc")}</p>
                  </div>
                  <Button variant="outline" onClick={() => void refreshModels()} disabled={pending[stateKey("refresh-models", editingId ?? "")] }>
                    {pending[stateKey("refresh-models", editingId ?? "")] ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    {t("settings.aiTools.refreshModels")}
                  </Button>
                </div>
                <div className="flex min-w-0 flex-wrap gap-2 sm:flex-nowrap">
                  <Input value={manualModel} onChange={(event) => setManualModel(event.target.value)} placeholder={t("settings.aiTools.manualModelPlaceholder")} className="min-w-0 flex-1 font-mono" aria-label={t("settings.aiTools.manualModelPlaceholder")} />
                  <Button onClick={() => void addModel()} disabled={!manualModel.trim() || pending[stateKey("add-model", editingId ?? "")] }><Plus />{t("settings.aiTools.addModel")}</Button>
                </div>
                {current?.models.length === 0 ? (
                  <p className="border-y py-6 text-center text-sm text-muted-foreground">{t("settings.aiTools.noModels")}</p>
                ) : (
                  <ul className="divide-y border-y">
                    {current?.models.map((model) => (
                      <li key={model.id} className="flex min-w-0 flex-wrap items-center gap-2 py-2 sm:flex-nowrap">
                        <div className="min-w-0 flex-1">
                          <p className="break-all font-mono text-xs">{model.modelId}</p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <Badge variant="outline">{model.source}</Badge>
                            <Badge variant={model.available ? "secondary" : "destructive"}>{model.available ? t("settings.aiTools.available") : t("settings.aiTools.unavailable")}</Badge>
                            {draft.defaultModelId === model.modelId && <Badge>{t("settings.aiTools.defaultModel")}</Badge>}
                          </div>
                        </div>
                        {draft.defaultModelId !== model.modelId && (
                          <Button variant="outline" onClick={() => setDraft({ ...draft, defaultModelId: model.modelId })}>{t("settings.aiTools.setDefaultModel")}</Button>
                        )}
                        {model.source === "manual" && <IconButton label={t("common.delete")} onClick={() => requestDeleteModel(model)}><Trash2 /></IconButton>}
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </div>
          </Tabs>

          {inlineError && <p className="mx-4 break-words text-xs text-destructive" role="alert">{inlineError}</p>}
          <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t px-4 py-3">
            {editingId && current && (
              <Button variant="destructive" onClick={() => requestDeleteConnection(current)} className="sm:mr-auto">
                <Trash2 />{t("common.delete")}
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => void saveConnection()} disabled={!draft.name.trim() || !draft.baseUrl.trim() || pending[stateKey("save", editingId ?? "new")]}>
              {pending[stateKey("save", editingId ?? "new")] && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <DialogContent className="rounded-lg sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={async () => {
              const action = confirm?.action;
              setConfirm(null);
              if (action) await action();
            }}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
