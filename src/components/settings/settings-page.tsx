"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { toast } from "sonner";
import type { Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useScrollOverflow } from "@/hooks/use-scroll-overflow";
import {
  Settings,
  Cpu,
  FileText,
  SlidersHorizontal,
  Bell,
  HardDrive,
  Package,
  Keyboard,
  X,
  Plus,
  Star,
  Trash2,
  Edit,
  Eye,
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  getConfigValue,
  setConfigValue,
  getConfigValues,
  getAvailableTerminalApps,
  getAvailableEditors,
} from "@/actions/config-actions";
import {
  getPrompts,
  createPrompt,
  updatePrompt,
  deletePrompt,
} from "@/actions/prompt-actions";
import {
  getBuiltinPrompts,
  saveSystemDirective,
  resetSystemDirective,
  saveWorkbenchDirective,
  resetWorkbenchDirective,
  type BuiltinPromptsData,
} from "@/actions/builtin-prompt-actions";
import { getAvailableProviders } from "@/actions/ai-config-actions";
import { CapabilitySlotsSection } from "@/components/settings/capability-slots-section";
import type { TestResult } from "@/lib/cli-test";
import type { ProviderAvailability } from "@/lib/ai/types";
import type { AgentPrompt } from "@prisma/client";
import type { DetectedTerminalApp, DetectedEditor } from "@/lib/platform";
import type { GitPathRule } from "@/lib/git-url";
import { BackupSection } from "./backup-section";
import { ExtensionsSection } from "./extensions-section";
import { KeyboardShortcutsSection } from "./keyboard-shortcuts-section";
import { HarnessTargetsSection } from "./harness-targets-section";
import { LabelsSection } from "./labels-section";
import { FolderBrowserDialog } from "@/components/layout/folder-browser-dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Inline SegmentedToggle
// ---------------------------------------------------------------------------
function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border/50 bg-muted/30 p-1 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-3.5 py-1.5 text-sm font-medium transition-all duration-200 cursor-pointer",
            value === opt.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setting row helper
// ---------------------------------------------------------------------------
function SettingRow({
  label,
  description,
  children,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-4 border-b border-border/50 last:border-0",
        className
      )}
    >
      <div className="min-w-0 flex-1 pr-4">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SECTIONS = [
  {
    id: "general",
    labelKey: "settings.general" as const,
    descKey: "settings.generalDesc" as const,
    icon: Settings,
    accent: "blue",
  },
  {
    id: "ai-tools",
    labelKey: "settings.aiTools.title" as const,
    descKey: "settings.aiTools.cliVerificationDesc" as const,
    icon: Cpu,
    accent: "emerald",
  },
  {
    id: "prompts",
    labelKey: "settings.prompts" as const,
    descKey: "settings.promptsDesc" as const,
    icon: FileText,
    accent: "violet",
  },
  {
    id: "config",
    labelKey: "settings.config" as const,
    descKey: "settings.configDesc" as const,
    icon: SlidersHorizontal,
    accent: "amber",
  },
  {
    id: "extensions",
    labelKey: "settings.extensions.title" as const,
    descKey: "settings.extensions.navDesc" as const,
    icon: Package,
    accent: "indigo",
  },
  {
    id: "notifications",
    labelKey: "settings.notifications.title" as const,
    descKey: "settings.notifications.navDesc" as const,
    icon: Bell,
    accent: "rose",
  },
  {
    id: "backup",
    labelKey: "settings.backup.title" as const,
    descKey: "settings.backup.navDesc" as const,
    icon: HardDrive,
    accent: "cyan",
  },
  {
    id: "keyboard-shortcuts",
    labelKey: "settings.keyboardShortcuts" as const,
    descKey: "settings.keyboardShortcutsDesc" as const,
    icon: Keyboard,
    accent: "violet",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const ACCENT_STYLES: Record<
  string,
  { bg: string; text: string; ring: string; indicator: string }
> = {
  blue: {
    bg: "bg-accent",
    text: "text-foreground",
    ring: "ring-border",
    indicator: "bg-foreground",
  },
  emerald: {
    bg: "bg-accent",
    text: "text-foreground",
    ring: "ring-border",
    indicator: "bg-foreground",
  },
  violet: {
    bg: "bg-accent",
    text: "text-foreground",
    ring: "ring-border",
    indicator: "bg-foreground",
  },
  amber: {
    bg: "bg-accent",
    text: "text-foreground",
    ring: "ring-border",
    indicator: "bg-foreground",
  },
  cyan: {
    bg: "bg-accent",
    text: "text-foreground",
    ring: "ring-border",
    indicator: "bg-foreground",
  },
  rose: {
    bg: "bg-accent",
    text: "text-foreground",
    ring: "ring-border",
    indicator: "bg-foreground",
  },
  indigo: {
    bg: "bg-accent",
    text: "text-foreground",
    ring: "ring-border",
    indicator: "bg-foreground",
  },
};

// ---------------------------------------------------------------------------
// CLI Adapters (AI Tools)
// ---------------------------------------------------------------------------
// The AI Tools list is rendered dynamically from the provider registry
// (getAvailableProviders) — adding a provider there surfaces it here with no
// UI change. The provider `name` ("claude", "codex", …) is the identifier
// used for the default-adapter preference and the test endpoint.
const DEFAULT_CLI_ADAPTER_KEY = "ai-manager:default-cli-adapter";

// ---------------------------------------------------------------------------
// System Config types
// ---------------------------------------------------------------------------
type RuleEditState = {
  host: string;
  ownerMatch: string;
  localPathTemplate: string;
  priority: number;
};

const EMPTY_FORM: RuleEditState = {
  host: "",
  ownerMatch: "*",
  localPathTemplate: "",
  priority: 0,
};

/**
 * Normalize a base path for git clone-path templates to forward slashes.
 * A Windows folder pick comes back as `D:\code`, but the template machinery
 * joins `/`-based segments ({path}, {owner}, {repo}), producing mixed
 * `D:\code/owner/repo`. Git on Windows accepts `/` natively, so canonicalize
 * the whole thing to `/` and strip any trailing separators (both kinds).
 */
const normalizeTemplateBasePath = (p: string): string =>
  p.replace(/\\/g, "/").replace(/\/+$/, "");

type SystemForm = {
  maxUploadMb: number;
  maxConcurrent: number;
  maxReadableMb: number;
  archiveDelayDays: number;
  taskDefaultUseWorktree: boolean;
  taskDefaultAutoStart: boolean;
};
type GitParamsForm = { timeoutSec: number };
type SearchForm = {
  resultLimit: number;
  allModeCap: number;
  debounceMs: number;
  snippetLength: number;
  codeTimeoutSec: number;
};
type MissionsGridForm = {
  minCols: number;
  maxCols: number;
  minRows: number;
  maxRows: number;
};
type HookStatus = { installed: boolean; hookPath: string };

/** The two editable built-in directives: normal tasks vs. the project workbench task. */
type DirectiveKind = "system" | "workbench";

function directiveRows(b: BuiltinPromptsData) {
  return [
    {
      kind: "system" as DirectiveKind,
      value: b.systemDirective,
      isCustom: b.systemDirectiveIsCustom,
      titleKey: "settings.prompts.builtin.systemTitle" as TranslationKey,
      descKey: "settings.prompts.builtin.systemDesc" as TranslationKey,
    },
    {
      kind: "workbench" as DirectiveKind,
      value: b.workbenchDirective,
      isCustom: b.workbenchDirectiveIsCustom,
      titleKey: "settings.prompts.builtin.workbenchTitle" as TranslationKey,
      descKey: "settings.prompts.builtin.workbenchDesc" as TranslationKey,
    },
  ];
}

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================
export function SettingsPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useI18n();

  const [activeSection, setActiveSection] = useState<SectionId>("general");
  const tabsRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  // ── General state ──────────────────────────────────────────────
  const [mounted, setMounted] = useState(false);
  const [terminalApp, setTerminalApp] = useState("Terminal");
  const [detectedApps, setDetectedApps] = useState<DetectedTerminalApp[]>([]);
  const [editorCommand, setEditorCommand] = useState("");
  const [detectedEditors, setDetectedEditors] = useState<DetectedEditor[]>([]);
  const [terminalFontSize, setTerminalFontSize] = useState(13);
  const [terminalFontFamily, setTerminalFontFamily] = useState(
    "Menlo, Monaco, 'Courier New', monospace"
  );

  // ── AI Tools state ─────────────────────────────────────────────
  const [providers, setProviders] = useState<ProviderAvailability[]>([]);
  const [defaultAdapter, setDefaultAdapter] = useState("claude");
  const [testingAdapter, setTestingAdapter] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(
    {}
  );

  // ── Prompts state ──────────────────────────────────────────────
  const [prompts, setPrompts] = useState<AgentPrompt[]>([]);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<AgentPrompt | null>(null);
  const [deletePromptId, setDeletePromptId] = useState<string | null>(null);
  const [promptName, setPromptName] = useState("");
  const [promptDescription, setPromptDescription] = useState("");
  const [promptContent, setPromptContent] = useState("");
  // 内置提示语：系统声明 + 工作台声明（都可编辑）+ 子任务回推引导语（只读）
  const [builtinPrompts, setBuiltinPrompts] = useState<BuiltinPromptsData | null>(null);
  const [directiveDraft, setDirectiveDraft] = useState("");
  const [savingDirective, setSavingDirective] = useState(false);
  // 内置提示语只在弹窗里看/编辑完整内容，列表处只展示 3 行预览。
  // 两条声明共用一个编辑弹窗，非 null 即打开，值表示正在编辑哪条。
  const [directiveEditing, setDirectiveEditing] = useState<DirectiveKind | null>(null);
  const [childDialogOpen, setChildDialogOpen] = useState(false);

  // ── System Config state ────────────────────────────────────────
  const [rules, setRules] = useState<GitPathRule[]>([]);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRuleForm, setEditRuleForm] = useState<RuleEditState>({
    ...EMPTY_FORM,
  });
  const [showAddRuleForm, setShowAddRuleForm] = useState(false);
  const [addRuleForm, setAddRuleForm] = useState<RuleEditState>({
    ...EMPTY_FORM,
  });
  const [useFullPath, setUseFullPath] = useState(false);
  const [editUseFullPath, setEditUseFullPath] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [deleteRuleConfirmId, setDeleteRuleConfirmId] = useState<string | null>(
    null
  );
  // Folder picker for git rule template — null when closed; otherwise which form is active
  const [pickerTarget, setPickerTarget] = useState<"add" | "edit" | null>(null);
  const [systemForm, setSystemForm] = useState<SystemForm>({
    maxUploadMb: 50,
    maxConcurrent: 3,
    maxReadableMb: 5,
    archiveDelayDays: 7,
    taskDefaultUseWorktree: true,
    taskDefaultAutoStart: false,
  });
  const [gitParamsForm, setGitParamsForm] = useState<GitParamsForm>({
    timeoutSec: 30,
  });
  const [searchForm, setSearchForm] = useState<SearchForm>({
    resultLimit: 20,
    allModeCap: 5,
    debounceMs: 250,
    snippetLength: 80,
    codeTimeoutSec: 30,
  });
  const [missionsGridForm, setMissionsGridForm] = useState<MissionsGridForm>({
    minCols: 1,
    maxCols: 5,
    minRows: 1,
    maxRows: 5,
  });
  const [hookStatus, setHookStatus] = useState<HookStatus | null>(null);
  const [hookLoading, setHookLoading] = useState(false);
  const [autoUploadTypes, setAutoUploadTypes] = useState("");


  // ── Notifications state ────────────────────────────────────────
  const [notifEnabled, setNotifEnabled] = useState(true);

  // =========================================================================
  // EFFECTS — mirror every original component
  // =========================================================================

  // Mount
  useEffect(() => setMounted(true), []);

  // General config load
  useEffect(() => {
    getConfigValue<string>("terminal.app", "Terminal").then(setTerminalApp);
    getAvailableTerminalApps().then(setDetectedApps);
    getConfigValue<string>("editor.command", "").then(setEditorCommand);
    getAvailableEditors().then(setDetectedEditors);
    getConfigValue<number>("terminal.fontSize", 13).then(setTerminalFontSize);
    getConfigValue<string>("terminal.fontFamily", "Menlo, Monaco, 'Courier New', monospace").then(setTerminalFontFamily);
  }, []);

  // Normalize legacy values: if terminal.app was saved as a display name
  // (e.g. "iTerm2") instead of its canonical value ("iTerm"), migrate it once
  // the detected list is available — otherwise the input shows the name while
  // the buttons/open logic use the value, and nothing highlights until clicked.
  useEffect(() => {
    if (detectedApps.length === 0 || !terminalApp) return;
    if (detectedApps.some((a) => a.value === terminalApp)) return; // already canonical
    const byName = detectedApps.find((a) => a.name === terminalApp);
    if (byName) {
      setTerminalApp(byName.value);
      void setConfigValue("terminal.app", byName.value);
    }
  }, [detectedApps, terminalApp]);

  useEffect(() => {
    if (detectedEditors.length === 0 || !editorCommand) return;
    if (detectedEditors.some((e) => e.command === editorCommand)) return;
    const byName = detectedEditors.find((e) => e.name === editorCommand);
    if (byName) {
      setEditorCommand(byName.command);
      void setConfigValue("editor.command", byName.command);
    }
  }, [detectedEditors, editorCommand]);

  // AI Tools — providers from the registry + default adapter from localStorage
  useEffect(() => {
    getAvailableProviders().then(setProviders);
    const stored = localStorage.getItem(DEFAULT_CLI_ADAPTER_KEY);
    if (stored) setDefaultAdapter(stored);
  }, []);

  // Prompts load
  useEffect(() => {
    getPrompts().then(setPrompts);
  }, []);

  // 内置提示语 load（草稿在打开编辑弹窗时才填）
  useEffect(() => {
    getBuiltinPrompts().then(setBuiltinPrompts);
  }, []);

  // System config load
  const fetchHookStatus = async () => {
    try {
      const res = await fetch("/api/internal/hooks/install");
      if (res.ok) {
        const data = (await res.json()) as HookStatus;
        setHookStatus(data);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    getConfigValue<GitPathRule[]>("git.pathMappingRules", []).then((loaded) => {
      // Defensive: guarantee unique non-empty ids on every loaded rule.
      // Legacy / hand-edited configs may have missing or duplicate ids,
      // which breaks the "edit this row" UI (always reopens the first match).
      const seen = new Set<string>();
      let dirty = false;
      const normalized = loaded.map((r) => {
        if (!r.id || seen.has(r.id)) {
          dirty = true;
          const fresh = { ...r, id: crypto.randomUUID() };
          seen.add(fresh.id);
          return fresh;
        }
        seen.add(r.id);
        return r;
      });
      setRules(normalized);
      if (dirty) void setConfigValue("git.pathMappingRules", normalized);
    });
    getConfigValue<string[]>(
      "hooks.autoUploadTypes",
      [
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "svg",
        "pdf",
        "md",
        "txt",
        "json",
      ]
    ).then((types) => {
      setAutoUploadTypes(types.join(", "));
    });
    fetchHookStatus();
    getConfigValues([
      "system.maxUploadBytes",
      "system.maxConcurrentExecutions",
      "system.maxReadableFileBytes",
      "board.archiveDelayDays",
      "task.defaultUseWorktree",
      "task.defaultAutoStart",
      "git.timeoutSec",
      "search.resultLimit",
      "search.allModeCap",
      "search.debounceMs",
      "search.snippetLength",
      "search.codeTimeoutSec",
      "missions.grid.minCols",
      "missions.grid.maxCols",
      "missions.grid.minRows",
      "missions.grid.maxRows",
    ]).then((cfg) => {
      const maxBytes = (cfg["system.maxUploadBytes"] as number) ?? 52428800;
      const maxReadableBytes =
        (cfg["system.maxReadableFileBytes"] as number) ?? 5_242_880;
      setSystemForm({
        maxUploadMb: Math.round(maxBytes / 1024 / 1024),
        maxConcurrent:
          (cfg["system.maxConcurrentExecutions"] as number) ?? 3,
        maxReadableMb: Math.round(maxReadableBytes / 1024 / 1024),
        archiveDelayDays:
          (cfg["board.archiveDelayDays"] as number) ?? 7,
        taskDefaultUseWorktree:
          typeof cfg["task.defaultUseWorktree"] === "boolean"
            ? (cfg["task.defaultUseWorktree"] as boolean)
            : true,
        taskDefaultAutoStart:
          typeof cfg["task.defaultAutoStart"] === "boolean"
            ? (cfg["task.defaultAutoStart"] as boolean)
            : false,
      });
      setGitParamsForm({
        timeoutSec: (cfg["git.timeoutSec"] as number) ?? 30,
      });
      setSearchForm({
        resultLimit: (cfg["search.resultLimit"] as number) ?? 20,
        allModeCap: (cfg["search.allModeCap"] as number) ?? 5,
        debounceMs: (cfg["search.debounceMs"] as number) ?? 250,
        snippetLength: (cfg["search.snippetLength"] as number) ?? 80,
        codeTimeoutSec: (cfg["search.codeTimeoutSec"] as number) ?? 30,
      });
      setMissionsGridForm({
        minCols: (cfg["missions.grid.minCols"] as number) ?? 1,
        maxCols: (cfg["missions.grid.maxCols"] as number) ?? 5,
        minRows: (cfg["missions.grid.minRows"] as number) ?? 1,
        maxRows: (cfg["missions.grid.maxRows"] as number) ?? 5,
      });
    });
  }, []);


  // Notifications load
  useEffect(() => {
    getConfigValue<boolean>("notification.enabled", true).then(setNotifEnabled);
  }, []);

  // =========================================================================
  // HANDLERS — General
  // =========================================================================

  // =========================================================================
  // HANDLERS — AI Tools
  // =========================================================================
  function handleSetAdapterDefault(provider: string) {
    setDefaultAdapter(provider);
    localStorage.setItem(DEFAULT_CLI_ADAPTER_KEY, provider);
  }

  async function handleTestAdapter(provider: string) {
    if (testingAdapter) return;
    setTestingAdapter(provider);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[provider];
      return next;
    });
    try {
      const res = await fetch("/api/adapters/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data: TestResult = await res.json();
      setTestResults((prev) => ({ ...prev, [provider]: data }));
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [provider]: {
          ok: false,
          checks: [
            {
              name: "network_error",
              passed: false,
              message: "Network request failed",
            },
          ],
        },
      }));
    } finally {
      setTestingAdapter(null);
    }
  }

  // =========================================================================
  // HANDLERS — Prompts
  // =========================================================================
  const openCreatePromptDialog = useCallback(() => {
    setEditingPrompt(null);
    setPromptName("");
    setPromptDescription("");
    setPromptContent("");
    setPromptDialogOpen(true);
  }, []);

  const openEditPromptDialog = useCallback((prompt: AgentPrompt) => {
    setEditingPrompt(prompt);
    setPromptName(prompt.name);
    setPromptDescription(prompt.description ?? "");
    setPromptContent(prompt.content);
    setPromptDialogOpen(true);
  }, []);

  const handleSavePrompt = useCallback(async () => {
    if (!promptName.trim() || !promptContent.trim()) return;
    if (editingPrompt) {
      await updatePrompt(editingPrompt.id, {
        name: promptName.trim(),
        description: promptDescription.trim() || undefined,
        content: promptContent.trim(),
      });
    } else {
      await createPrompt({
        name: promptName.trim(),
        description: promptDescription.trim() || undefined,
        content: promptContent.trim(),
      });
    }
    setPromptDialogOpen(false);
    const updated = await getPrompts();
    setPrompts(updated);
    router.refresh();
  }, [promptName, promptDescription, promptContent, editingPrompt, router]);

  const handleDeletePrompt = useCallback(async () => {
    if (!deletePromptId) return;
    await deletePrompt(deletePromptId);
    setDeletePromptId(null);
    const updated = await getPrompts();
    setPrompts(updated);
    router.refresh();
  }, [deletePromptId, router]);

  const handleSaveDirective = useCallback(async () => {
    if (!directiveEditing) return;
    setSavingDirective(true);
    try {
      if (directiveEditing === "system") {
        await saveSystemDirective(directiveDraft);
      } else {
        await saveWorkbenchDirective(directiveDraft);
      }
      setBuiltinPrompts(await getBuiltinPrompts());
      setDirectiveEditing(null);
      toast.success(t("settings.prompts.builtin.saved"));
    } finally {
      setSavingDirective(false);
    }
  }, [directiveDraft, directiveEditing, t]);

  const handleResetDirective = useCallback(async () => {
    if (!directiveEditing) return;
    setSavingDirective(true);
    try {
      const def =
        directiveEditing === "system"
          ? await resetSystemDirective()
          : await resetWorkbenchDirective();
      setBuiltinPrompts(await getBuiltinPrompts());
      setDirectiveDraft(def);
      toast.info(t("settings.prompts.builtin.resetDone"));
    } finally {
      setSavingDirective(false);
    }
  }, [directiveEditing, t]);

  // =========================================================================
  // HANDLERS — System Config
  // =========================================================================
  const handleSaveSystem = async () => {
    await setConfigValue(
      "system.maxUploadBytes",
      systemForm.maxUploadMb * 1024 * 1024
    );
    await setConfigValue(
      "system.maxConcurrentExecutions",
      systemForm.maxConcurrent
    );
    await setConfigValue(
      "system.maxReadableFileBytes",
      systemForm.maxReadableMb * 1024 * 1024
    );
    await setConfigValue(
      "board.archiveDelayDays",
      systemForm.archiveDelayDays
    );
  };

  const handleSaveTask = async () => {
    await setConfigValue(
      "task.defaultUseWorktree",
      systemForm.taskDefaultUseWorktree
    );
    await setConfigValue(
      "task.defaultAutoStart",
      systemForm.taskDefaultAutoStart
    );
    // Saving the task defaults also confirms them, so MCP's first-run
    // create_task won't prompt the calling AI again.
    await setConfigValue("task.mcpDefaultsConfigured", true);
  };

  const handleSaveGitParams = async () => {
    await setConfigValue("git.timeoutSec", gitParamsForm.timeoutSec);
  };

  const handleSaveSearch = async () => {
    await setConfigValue("search.resultLimit", searchForm.resultLimit);
    await setConfigValue("search.allModeCap", searchForm.allModeCap);
    await setConfigValue("search.debounceMs", searchForm.debounceMs);
    await setConfigValue("search.snippetLength", searchForm.snippetLength);
    await setConfigValue(
      "search.codeTimeoutSec",
      searchForm.codeTimeoutSec
    );
  };

  const handleSaveMissionsGrid = async () => {
    const minCols = Math.min(
      missionsGridForm.minCols,
      missionsGridForm.maxCols
    );
    const maxCols = Math.max(
      missionsGridForm.minCols,
      missionsGridForm.maxCols
    );
    const minRows = Math.min(
      missionsGridForm.minRows,
      missionsGridForm.maxRows
    );
    const maxRows = Math.max(
      missionsGridForm.minRows,
      missionsGridForm.maxRows
    );
    setMissionsGridForm({ minCols, maxCols, minRows, maxRows });
    await setConfigValue("missions.grid.minCols", minCols);
    await setConfigValue("missions.grid.maxCols", maxCols);
    await setConfigValue("missions.grid.minRows", minRows);
    await setConfigValue("missions.grid.maxRows", maxRows);
  };

  const handleSaveAutoUploadTypes = async () => {
    const types = autoUploadTypes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await setConfigValue("hooks.autoUploadTypes", types);
  };

  const handleToggleHook = async () => {
    if (!hookStatus) return;
    setHookLoading(true);
    try {
      const method = hookStatus.installed ? "DELETE" : "POST";
      await fetch("/api/internal/hooks/install", { method });
      await fetchHookStatus();
    } finally {
      setHookLoading(false);
    }
  };

  /** Preview what a Git URL would resolve to with a given template */
  function previewPath(tpl: string, sampleUrl: string): string {
    if (!tpl || !sampleUrl) return "";
    const trimmed = sampleUrl.trim();
    let segments: string[] = [];
    const sshShort = trimmed.match(/^git@[^:]+:(.+)$/);
    if (sshShort) {
      segments = sshShort[1].replace(/\.git\/?$/, "").split("/").filter(Boolean);
    } else {
      try {
        const url = new URL(trimmed);
        segments = decodeURIComponent(url.pathname).replace(/\.git\/?$/, "").split("/").filter(Boolean);
      } catch { return ""; }
    }
    if (!segments.length) return "";
    const owner = segments[0];
    const repo = segments[segments.length - 1];
    const fullPath = segments.join("/");
    if (tpl.includes("{path}")) {
      return tpl.replace("{path}", fullPath).replace("{owner}", owner).replace("{repo}", repo).replace(/\/+$/, "");
    }
    const base = tpl.replace("{owner}", owner).replace("{repo}", "").replace(/\/+$/, "");
    return `${base}/${repo}`;
  }

  const handleAddRule = async () => {
    if (!addRuleForm.host.trim() || !addRuleForm.localPathTemplate.trim())
      return;
    const basePath = normalizeTemplateBasePath(addRuleForm.localPathTemplate.trim());
    const template = useFullPath ? `${basePath}/{path}` : basePath;
    const newRule: GitPathRule = {
      id: crypto.randomUUID(),
      host: addRuleForm.host.trim(),
      ownerMatch: addRuleForm.ownerMatch.trim() || "*",
      localPathTemplate: template,
      priority: addRuleForm.priority,
    };
    const updated = [...rules, newRule];
    await setConfigValue("git.pathMappingRules", updated);
    setRules(updated);
    setAddRuleForm({ ...EMPTY_FORM });
    setUseFullPath(false);
    setShowAddRuleForm(false);
  };

  const handleEditRuleStart = (rule: GitPathRule) => {
    // Parse template: if it ends with `{path}`, peel it off and toggle the switch on
    const tpl = rule.localPathTemplate;
    const hasFullPath = /\/\{path\}\/?$/.test(tpl);
    const basePath = hasFullPath
      ? tpl.replace(/\/?\{path\}\/?$/, "").replace(/\/+$/, "")
      : tpl;
    setEditingRuleId(rule.id);
    setEditRuleForm({
      host: rule.host,
      ownerMatch: rule.ownerMatch,
      localPathTemplate: basePath,
      priority: rule.priority,
    });
    setEditUseFullPath(hasFullPath);
  };

  const handleEditRuleSave = async (ruleId: string) => {
    if (!editRuleForm.host.trim() || !editRuleForm.localPathTemplate.trim())
      return;
    const basePath = normalizeTemplateBasePath(editRuleForm.localPathTemplate.trim());
    const template = editUseFullPath ? `${basePath}/{path}` : basePath;
    const updated = rules.map((r) =>
      r.id === ruleId
        ? {
            ...r,
            host: editRuleForm.host.trim(),
            ownerMatch: editRuleForm.ownerMatch.trim() || "*",
            localPathTemplate: template,
            priority: editRuleForm.priority,
          }
        : r
    );
    await setConfigValue("git.pathMappingRules", updated);
    setRules(updated);
    setEditingRuleId(null);
    setEditUseFullPath(false);
  };

  const handleDeleteRule = async (ruleId: string) => {
    const updated = rules.filter((r) => r.id !== ruleId);
    await setConfigValue("git.pathMappingRules", updated);
    setRules(updated);
    setDeleteRuleConfirmId(null);
  };

  // =========================================================================
  // HANDLERS — Notifications
  // =========================================================================
  async function handleToggleNotif() {
    const next = !notifEnabled;
    setNotifEnabled(next);
    await setConfigValue("notification.enabled", next);
  }

  // =========================================================================
  // Tab indicator
  // =========================================================================
  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  // 顶部 tab 栏：项目多了会横向溢出，鼠标在可点击 tab 上难滚动 —— 左右箭头各滚一个 tab 宽度。
  const scrollTabs = useCallback((dir: "left" | "right") => {
    const c = tabsRef.current;
    if (!c) return;
    const firstTab = c.querySelector<HTMLElement>("[data-section]");
    const step = firstTab ? firstTab.offsetWidth + 4 : 140;
    c.scrollBy({ left: dir === "left" ? -step : step, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const container = tabsRef.current;
    if (!container) return;
    const activeTab = container.querySelector<HTMLButtonElement>(
      `[data-section="${activeSection}"]`
    );
    if (!activeTab) return;
    const containerRect = container.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    setIndicatorStyle({
      left: tabRect.left - containerRect.left,
      width: tabRect.width,
    });
  }, [activeSection]);

  // tab 栏横向溢出检测 —— 溢出才显示滚动箭头（左右按 scrollLeft 分别判断）。复用共享 hook；
  // deps 挂 locale：中英文标签宽度不同。
  const { canScrollLeft: canScrollTabsLeft, canScrollRight: canScrollTabsRight } =
    useScrollOverflow(tabsRef, [locale]);

  const activeConfig = SECTIONS.find((s) => s.id === activeSection);
  const accentStyle = activeConfig
    ? ACCENT_STYLES[activeConfig.accent]
    : ACCENT_STYLES.blue;

  // =========================================================================
  // RENDER — Section content
  // =========================================================================

  function renderGeneral() {
    const themeOptions = [
      { value: "light" as const, label: t("settings.themeLight") },
      { value: "dark" as const, label: t("settings.themeDark") },
      { value: "system" as const, label: t("settings.themeSystem") },
    ];
    const langOptions = [
      { value: "zh" as Locale, label: "中文" },
      { value: "en" as Locale, label: "English" },
    ];

    return (
      <div className="divide-y divide-border/50">
        {/* Theme */}
        <SettingRow
          label={t("settings.theme")}
          description={t("settings.themeDesc")}
        >
          {!mounted ? (
            <div className="inline-flex h-9 rounded-lg border border-border/50 bg-muted/30 p-1 w-[200px]" />
          ) : (
            <SegmentedToggle
              options={themeOptions}
              value={(theme ?? "system") as "light" | "dark" | "system"}
              onChange={(v) => setTheme(v)}
            />
          )}
        </SettingRow>

        {/* Language */}
        <SettingRow
          label={t("settings.language")}
          description={t("settings.languageDesc")}
        >
          <SegmentedToggle
            options={langOptions}
            value={locale}
            onChange={(v) => setLocale(v as typeof locale)}
          />
        </SettingRow>

        {/* Terminal App — show all known apps; disable + tooltip the uninstalled ones */}
        <div className="py-4 border-b border-border/50">
          <div className="min-w-0 flex-1 pr-4">
            <div className="text-sm font-medium">
              {t("settings.terminal.label")}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {t("settings.terminal.desc")}
            </div>
          </div>
          {detectedApps.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {detectedApps.map((app) => {
                const selected = terminalApp === app.value;
                const className = cn(
                  "rounded-lg border px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
                  !app.installed
                    ? "cursor-not-allowed border-dashed border-border/60 text-muted-foreground/40"
                    : selected
                      ? "border-foreground bg-accent text-foreground font-medium cursor-pointer"
                      : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground cursor-pointer"
                );
                const onPick = () => {
                  if (!app.installed) return;
                  setTerminalApp(app.value);
                  void setConfigValue("terminal.app", app.value);
                };
                if (app.installed) {
                  return (
                    <button key={app.value} type="button" onClick={onPick} className={className}>
                      {app.name}
                    </button>
                  );
                }
                return (
                  <Tooltip key={app.value}>
                    <TooltipTrigger
                      render={
                        <button type="button" onClick={onPick} className={className}>
                          {app.name}
                        </button>
                      }
                    />
                    <TooltipContent side="top">{t("settings.app.notInstalled")}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>

        {/* Terminal font — size + family (helps on 2K/4K displays) */}
        <div className="py-4 border-b border-border/50">
          <div className="min-w-0 flex-1 pr-4">
            <div className="text-sm font-medium">{t("settings.terminalFont.label")}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {t("settings.terminalFont.desc")}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t("settings.terminalFont.size")}
              <input
                type="number"
                min={8}
                max={40}
                value={terminalFontSize}
                onChange={(e) => {
                  const v = Math.max(8, Math.min(40, Math.round(Number(e.target.value) || 13)));
                  setTerminalFontSize(v);
                  void setConfigValue("terminal.fontSize", v);
                }}
                className="h-8 w-20 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
            </label>
            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
              {t("settings.terminalFont.family")}
              <input
                type="text"
                value={terminalFontFamily}
                placeholder="Menlo, Monaco, 'Courier New', monospace"
                onChange={(e) => setTerminalFontFamily(e.target.value)}
                onBlur={(e) => {
                  const v = e.target.value.trim() || "Menlo, Monaco, 'Courier New', monospace";
                  setTerminalFontFamily(v);
                  void setConfigValue("terminal.fontFamily", v);
                }}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
            </label>
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground/70">
            {t("settings.terminalFont.hint")}
          </div>
        </div>

        {/* Editor — show all known editors; disable + tooltip the uninstalled ones */}
        <div className="py-4 border-b border-border/50">
          <div className="min-w-0 flex-1 pr-4">
            <div className="text-sm font-medium">
              {t("settings.editor.label")}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {t("settings.editor.desc")}
            </div>
          </div>
          {detectedEditors.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {detectedEditors.map((ed) => {
                const selected = editorCommand === ed.command;
                const className = cn(
                  "rounded-lg border px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
                  !ed.installed
                    ? "cursor-not-allowed border-dashed border-border/60 text-muted-foreground/40"
                    : selected
                      ? "border-foreground bg-accent text-foreground font-medium cursor-pointer"
                      : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground cursor-pointer"
                );
                const onPick = () => {
                  if (!ed.installed) return;
                  setEditorCommand(ed.command);
                  void setConfigValue("editor.command", ed.command);
                };
                if (ed.installed) {
                  return (
                    <button key={ed.command} type="button" onClick={onPick} className={className}>
                      {ed.name}
                    </button>
                  );
                }
                return (
                  <Tooltip key={ed.command}>
                    <TooltipTrigger
                      render={
                        <button type="button" onClick={onPick} className={className}>
                          {ed.name}
                        </button>
                      }
                    />
                    <TooltipContent side="top">{t("settings.app.notInstalled")}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderAiTools() {
    return (
      <div className="space-y-4">
      <ul className="divide-y rounded-xl border border-border bg-card">
        {providers.map((provider) => {
          const isDefault = defaultAdapter === provider.name;
          const isTesting = testingAdapter === provider.name;
          const result = testResults[provider.name];

          return (
            <li key={provider.name}>
              <div className="px-5 py-4">
                {/* Row: info left, actions right */}
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{provider.displayName}</span>
                      <Badge variant="outline">{t("label.builtin")}</Badge>
                      {isDefault && (
                        <Badge variant="secondary" className="shrink-0">
                          <Star className="h-3 w-3 mr-1 fill-yellow-400 text-yellow-400" />
                          {t("settings.prompts.default")}
                        </Badge>
                      )}
                      {result && (
                        <Badge
                          variant={result.ok ? "secondary" : "destructive"}
                          className={cn(
                            "shrink-0",
                            result.ok && "bg-green-600 text-white hover:bg-green-700"
                          )}
                        >
                          {result.ok ? (
                            <><CheckCircle2 className="h-3 w-3 mr-1" />{t("settings.aiTools.testPassed")}</>
                          ) : (
                            <><XCircle className="h-3 w-3 mr-1" />{t("settings.aiTools.testFailed")}</>
                          )}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {provider.cli.available && provider.cli.version
                        ? `${provider.name} · ${provider.cli.version}`
                        : provider.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!isDefault && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetAdapterDefault(provider.name)}
                      >
                        <Star className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                        {t("settings.prompts.setDefault")}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestAdapter(provider.name)}
                      disabled={isTesting}
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          {t("settings.aiTools.testing")}
                        </>
                      ) : (
                        t("settings.aiTools.testConnection")
                      )}
                    </Button>
                  </div>
                </div>

                {/* Test results */}
                {result && (
                  <div className="mt-3 rounded-md border border-border bg-muted/30 px-4 py-3">
                    <div className="space-y-1.5">
                      {result.checks.map((check) => (
                        <div
                          key={`${provider.name}-${check.name}`}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span
                            className={cn(
                              "w-1.5 h-1.5 rounded-full shrink-0",
                              check.passed ? "bg-green-500" : "bg-red-500"
                            )}
                          />
                          <span className={cn(
                            check.passed
                              ? "text-foreground"
                              : "text-red-700 dark:text-red-300"
                          )}>
                            {check.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
        <CapabilitySlotsSection />
      </div>
    );
  }

  function renderPrompts() {
    if (!mounted) {
      return <div className="h-32 rounded-lg bg-muted animate-pulse" />;
    }

    // The row being edited in the shared directive dialog (null when closed).
    const editingDirective = builtinPrompts
      ? directiveRows(builtinPrompts).find((r) => r.kind === directiveEditing)
      : undefined;

    return (
      <div className="space-y-4">
        {/* 内置提示语：系统声明 + 工作台声明（可编辑不可删）+ 子任务回推引导语（只读） */}
        {builtinPrompts && (
          <div className="space-y-4 rounded-xl border border-border/50 bg-card p-4">
            <div>
              <h3 className="text-sm font-medium">{t("settings.prompts.builtin.title")}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.prompts.builtin.desc")}
              </p>
            </div>

            {/* 系统声明 / 工作台声明 — 各 3 行预览，点「编辑」弹窗查看/编辑完整内容 */}
            {directiveRows(builtinPrompts).map((row, i) => (
              <div key={row.kind} className={i > 0 ? "space-y-2 border-t border-border/50 pt-4" : "space-y-2"}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">{t(row.titleKey)}</Label>
                    {row.isCustom && (
                      <Badge variant="secondary" className="rounded-full text-xs">
                        {t("settings.prompts.builtin.modified")}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDirectiveDraft(row.value);
                      setDirectiveEditing(row.kind);
                    }}
                  >
                    <Edit className="h-4 w-4" />
                    {t("settings.prompts.builtin.edit")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t(row.descKey)}</p>
                <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                  <p className="line-clamp-3 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                    {row.value}
                  </p>
                </div>
              </div>
            ))}

            {/* 子任务回推引导语 — 3 行预览，点「查看」弹窗看完整内容（只读） */}
            <div className="space-y-2 border-t border-border/50 pt-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">{t("settings.prompts.builtin.childTitle")}</Label>
                  <Badge variant="outline" className="rounded-full text-xs">
                    {t("settings.prompts.builtin.readonly")}
                  </Badge>
                </div>
                <Button variant="outline" onClick={() => setChildDialogOpen(true)}>
                  <Eye className="h-4 w-4" />
                  {t("settings.prompts.builtin.view")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.prompts.builtin.childDesc")}
              </p>
              <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                <p className="line-clamp-3 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                  {builtinPrompts.childReviewPrompt}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 自定义提示语 — 用一个容器区块包起来，与上方内置区块对称、更有分量 */}
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-sm font-medium">{t("settings.prompts.custom.title")}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.prompts.custom.desc")}
              </p>
            </div>
            <Button onClick={openCreatePromptDialog} variant="default" className="shrink-0">
              <Plus className="h-4 w-4 mr-2" />
              {t("settings.prompts.newPrompt")}
            </Button>
          </div>

          {prompts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-lg border border-dashed border-border/50">
              <p className="text-muted-foreground">{t("settings.prompts.empty")}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("settings.prompts.emptyHint")}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border/50 divide-y divide-border/50">
              {prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className="flex items-center justify-between px-4 py-3.5 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium truncate">{prompt.name}</h4>
                    {prompt.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">
                        {prompt.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-4">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEditPromptDialog(prompt)}
                      title={t("settings.prompts.editPrompt")}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeletePromptId(prompt.id)}
                      className="text-destructive"
                      title={t("settings.prompts.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 系统声明 / 工作台声明 — 共用编辑弹窗（完整内容，可编辑 / 恢复默认） */}
        <Dialog
          open={directiveEditing !== null}
          onOpenChange={(open) => !open && setDirectiveEditing(null)}
        >
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingDirective && t(editingDirective.titleKey)}</DialogTitle>
              <DialogDescription>
                {editingDirective && t(editingDirective.descKey)}
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={directiveDraft}
              onChange={(e) => setDirectiveDraft(e.target.value)}
              className="max-h-[60vh] min-h-[50vh] font-mono text-xs"
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleResetDirective}
                disabled={savingDirective || !editingDirective?.isCustom}
              >
                {t("settings.prompts.builtin.resetDefault")}
              </Button>
              <Button
                variant="default"
                onClick={handleSaveDirective}
                disabled={savingDirective || directiveDraft === editingDirective?.value}
              >
                {t("settings.prompts.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 子任务回推引导语 — 只读查看弹窗（完整内容） */}
        <Dialog open={childDialogOpen} onOpenChange={setChildDialogOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("settings.prompts.builtin.childTitle")}</DialogTitle>
              <DialogDescription>
                {t("settings.prompts.builtin.childDesc")}
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={builtinPrompts?.childReviewPrompt ?? ""}
              readOnly
              className="max-h-[60vh] min-h-[50vh] font-mono text-xs bg-muted/40 cursor-default"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setChildDialogOpen(false)}>
                {t("settings.prompts.close")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create/Edit Dialog */}
        <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingPrompt
                  ? t("settings.prompts.editPrompt")
                  : t("settings.prompts.newPrompt")}
              </DialogTitle>
              <DialogDescription>
                {editingPrompt
                  ? t("settings.prompts.editPrompt")
                  : t("settings.prompts.newPrompt")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="prompt-name">
                  {t("settings.prompts.promptName")}
                </Label>
                <Input
                  id="prompt-name"
                  value={promptName}
                  onChange={(e) => setPromptName(e.target.value)}
                  placeholder={t("settings.prompts.promptNamePlaceholder")}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="prompt-description">
                  {t("settings.prompts.promptDescription")}
                </Label>
                <Input
                  id="prompt-description"
                  value={promptDescription}
                  onChange={(e) => setPromptDescription(e.target.value)}
                  placeholder={t(
                    "settings.prompts.promptDescriptionPlaceholder"
                  )}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="prompt-content">
                  {t("settings.prompts.promptContent")}
                </Label>
                <Textarea
                  id="prompt-content"
                  value={promptContent}
                  onChange={(e) => setPromptContent(e.target.value)}
                  placeholder={t("settings.prompts.promptContentPlaceholder")}
                  className="mt-1.5 max-h-[55vh] min-h-[40vh] font-mono text-sm"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPromptDialogOpen(false)}
              >
                {t("settings.prompts.cancel")}
              </Button>
              <Button
                onClick={handleSavePrompt}
                disabled={!promptName.trim() || !promptContent.trim()}
              >
                {t("settings.prompts.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={!!deletePromptId}
          onOpenChange={(open) => !open && setDeletePromptId(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("settings.prompts.deleteConfirmTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("settings.prompts.deleteConfirmMessage")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeletePromptId(null)}
              >
                {t("settings.prompts.cancel")}
              </Button>
              <Button variant="destructive" onClick={handleDeletePrompt}>
                {t("settings.prompts.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  function renderSystemConfig() {
    return (
      <div className="space-y-8">
        {/* ── Git Path Mapping Rules ──────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">
                {t("settings.config.git.title")}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.config.git.desc")}
              </p>
            </div>
            <Button
              onClick={() => {
                setAddRuleForm({ ...EMPTY_FORM });
                setShowAddRuleForm(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("settings.config.git.addRule")}
            </Button>
          </div>

          <div className="space-y-3">
            {rules.length === 0 && !showAddRuleForm ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {t("settings.config.git.noRules")}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground/80">
                  {t("settings.config.git.noRulesFallback")}
                </p>
              </div>
            ) : (
              <ul className="divide-y rounded-xl border border-border bg-card">
                {rules.map((rule) =>
                  editingRuleId === rule.id ? (
                    <li key={rule.id} className="px-5 py-4 bg-muted/20">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="block text-xs text-muted-foreground">{t("settings.config.git.host")}</label>
                          <Input value={editRuleForm.host} onChange={(e) => setEditRuleForm((f) => ({ ...f, host: e.target.value }))} placeholder={t("settings.config.git.hostPlaceholder")} className="text-sm" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-xs text-muted-foreground">{t("settings.config.git.ownerMatch")}</label>
                          <Input value={editRuleForm.ownerMatch} onChange={(e) => setEditRuleForm((f) => ({ ...f, ownerMatch: e.target.value }))} placeholder={t("settings.config.git.ownerMatchPlaceholder")} className="text-sm" />
                        </div>
                        <div className="space-y-1.5 col-span-2">
                          <label className="block text-xs text-muted-foreground">{t("settings.config.git.localPathTemplate")}</label>
                          <div className="flex items-center gap-2">
                            <Input
                              value={editRuleForm.localPathTemplate}
                              onChange={(e) => setEditRuleForm((f) => ({ ...f, localPathTemplate: e.target.value }))}
                              placeholder={t("settings.config.git.localPathTemplatePlaceholder")}
                              className="text-sm font-mono flex-1"
                            />
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant={editUseFullPath ? "default" : "outline"}
                                    size="sm"
                                    type="button"
                                    onClick={() => setEditUseFullPath((v) => !v)}
                                    className="shrink-0 font-mono"
                                  >
                                    {"{path}"}
                                  </Button>
                                }
                              />
                              <TooltipContent side="top" className="max-w-xs">
                                <div className="space-y-1 text-xs">
                                  <div className="font-medium">{t("settings.config.git.pathTooltipTitle")}</div>
                                  <div className="opacity-80">{t("settings.config.git.pathTooltipDetail")}</div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    type="button"
                                    onClick={() => setPickerTarget("edit")}
                                  >
                                    <FolderOpen className="h-4 w-4" />
                                  </Button>
                                }
                              />
                              <TooltipContent>{t("settings.config.git.pickFolder")}</TooltipContent>
                            </Tooltip>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {editUseFullPath ? t("onboarding.step3.pathHintFull") : t("onboarding.step3.pathHintRepo")}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-xs text-muted-foreground">{t("settings.config.git.priority")}</label>
                          <Input type="number" value={editRuleForm.priority} onChange={(e) => setEditRuleForm((f) => ({ ...f, priority: Number(e.target.value) }))} className="text-sm w-24" />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-3">
                        <Button variant="ghost" size="sm" onClick={() => { setEditingRuleId(null); setEditUseFullPath(false); }}>{t("settings.config.git.cancel")}</Button>
                        <Button size="sm" onClick={() => handleEditRuleSave(rule.id)}>{t("settings.config.git.save")}</Button>
                      </div>
                    </li>
                  ) : (
                    <li key={rule.id} className="group px-5 py-4 hover:bg-muted/20 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{rule.host}</span>
                            {rule.ownerMatch !== "*" && (
                              <span className="text-xs text-muted-foreground">/ {rule.ownerMatch}</span>
                            )}
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{t("settings.config.git.priority")} {rule.priority}</Badge>
                          </div>
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground truncate">{rule.localPathTemplate}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon-sm" onClick={() => handleEditRuleStart(rule)} title={t("settings.config.git.edit")}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => setDeleteRuleConfirmId(rule.id)} className="text-destructive" title={t("settings.config.git.delete")}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  )
                )}
              </ul>
            )}

            {/* Add rule form */}
            {showAddRuleForm && (
              <div className="rounded-xl border border-border bg-muted/20 p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">{t("settings.config.git.host")}</label>
                    <Input value={addRuleForm.host} onChange={(e) => setAddRuleForm((f) => ({ ...f, host: e.target.value }))} placeholder={t("settings.config.git.hostPlaceholder")} className="text-sm" autoFocus />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">{t("settings.config.git.ownerMatch")}</label>
                    <Input value={addRuleForm.ownerMatch} onChange={(e) => setAddRuleForm((f) => ({ ...f, ownerMatch: e.target.value }))} placeholder={t("settings.config.git.ownerMatchPlaceholder")} className="text-sm" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">{t("settings.config.git.localPathTemplate")}</label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={addRuleForm.localPathTemplate}
                      onChange={(e) => setAddRuleForm((f) => ({ ...f, localPathTemplate: e.target.value }))}
                      placeholder={t("settings.config.git.localPathTemplatePlaceholder")}
                      className="text-sm font-mono flex-1"
                    />
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant={useFullPath ? "default" : "outline"}
                            size="sm"
                            type="button"
                            onClick={() => setUseFullPath((v) => !v)}
                            className="shrink-0 font-mono"
                          >
                            {"{path}"}
                          </Button>
                        }
                      />
                      <TooltipContent side="top" className="max-w-xs">
                        <div className="space-y-1 text-xs">
                          <div className="font-medium">{t("settings.config.git.pathTooltipTitle")}</div>
                          <div className="opacity-80">{t("settings.config.git.pathTooltipDetail")}</div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="outline"
                            size="icon"
                            type="button"
                            onClick={() => setPickerTarget("add")}
                          >
                            <FolderOpen className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <TooltipContent>{t("settings.config.git.pickFolder")}</TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {useFullPath ? t("onboarding.step3.pathHintFull") : t("onboarding.step3.pathHintRepo")}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">{t("settings.config.git.priority")}</label>
                  <Input type="number" value={addRuleForm.priority} onChange={(e) => setAddRuleForm((f) => ({ ...f, priority: Number(e.target.value) }))} className="text-sm w-24" />
                </div>

                {/* Live preview */}
                {addRuleForm.localPathTemplate && (() => {
                  const basePath = addRuleForm.localPathTemplate.trim().replace(/\/+$/, "");
                  const tpl = useFullPath ? `${basePath}/{path}` : basePath;
                  const samples = [
                    { label: "GitHub SSH", url: "git@github.com:user/my-app.git" },
                    { label: "GitHub HTTPS", url: "https://github.com/user/my-app.git" },
                    { label: "GitLab Subgroup", url: "https://gitlab.com/org/team/sub/my-api.git" },
                  ];
                  return (
                    <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">{t("onboarding.step3.previewLabel")}</span>
                        <div className="flex gap-1">
                          {samples.map((s, i) => (
                            <button key={i} type="button" onClick={() => setPreviewIdx(i)}
                              className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                                previewIdx === i ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
                              )}>
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <p className="font-mono text-[11px] text-muted-foreground truncate">{samples[previewIdx].url}</p>
                        <p className="font-mono text-sm">
                          <span className="text-muted-foreground">→ </span>
                          <span className="text-foreground font-medium">{previewPath(tpl, samples[previewIdx].url)}</span>
                        </p>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowAddRuleForm(false)}>{t("settings.config.git.cancel")}</Button>
                  <Button size="sm" onClick={handleAddRule} disabled={!addRuleForm.host.trim() || !addRuleForm.localPathTemplate.trim()}>
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    {t("settings.config.git.save")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Labels (level + worktree branch prefix) ──────────── */}
        <LabelsSection />

        {/* ── System Parameters ────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-muted/50 p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">
              {t("settings.config.system.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.config.system.desc")}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium">
                  {t("settings.config.system.maxUpload")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.config.system.maxUploadHint")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={systemForm.maxUploadMb}
                  onChange={(e) =>
                    setSystemForm((f) => ({
                      ...f,
                      maxUploadMb: Number(e.target.value),
                    }))
                  }
                  className="w-24 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
                />
                <span className="text-sm text-muted-foreground">MB</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium">
                  {t("settings.config.system.maxConcurrent")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.config.system.maxConcurrentHint")}
                </p>
              </div>
              <Input
                type="number"
                min={1}
                max={10}
                value={systemForm.maxConcurrent}
                onChange={(e) =>
                  setSystemForm((f) => ({
                    ...f,
                    maxConcurrent: Number(e.target.value),
                  }))
                }
                className="w-24 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium">
                  {t("settings.config.system.maxReadable")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.config.system.maxReadableHint")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={systemForm.maxReadableMb}
                  onChange={(e) =>
                    setSystemForm((f) => ({
                      ...f,
                      maxReadableMb: Number(e.target.value),
                    }))
                  }
                  className="w-24 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
                />
                <span className="text-sm text-muted-foreground">MB</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium">
                  {t("settings.config.system.archiveDelay")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.config.system.archiveDelayHint")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={systemForm.archiveDelayDays}
                  onChange={(e) =>
                    setSystemForm((f) => ({
                      ...f,
                      archiveDelayDays: Number(e.target.value),
                    }))
                  }
                  className="w-24 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
                />
                <span className="text-sm text-muted-foreground">
                  {t("settings.config.system.archiveDelayUnit")}
                </span>
              </div>
            </div>
          </div>
          <Button onClick={handleSaveSystem} className="rounded-lg">
            {t("common.save")}
          </Button>
        </div>

        {/* ── Task Defaults ─────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-muted/50 p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">
              {t("settings.config.task.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.config.task.desc")}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium">
                  {t("settings.config.system.taskDefaultWorktree")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.config.system.taskDefaultWorktreeHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setSystemForm((f) => ({
                    ...f,
                    taskDefaultUseWorktree: !f.taskDefaultUseWorktree,
                  }))
                }
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  systemForm.taskDefaultUseWorktree
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {systemForm.taskDefaultUseWorktree
                  ? t("task.worktreeYes")
                  : t("task.worktreeNo")}
              </button>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium">
                  {t("settings.config.system.taskDefaultAutoStart")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.config.system.taskDefaultAutoStartHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setSystemForm((f) => ({
                    ...f,
                    taskDefaultAutoStart: !f.taskDefaultAutoStart,
                  }))
                }
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  systemForm.taskDefaultAutoStart
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {systemForm.taskDefaultAutoStart
                  ? t("task.autoStartYes")
                  : t("task.autoStartNo")}
              </button>
            </div>
          </div>
          <Button onClick={handleSaveTask} className="rounded-lg">
            {t("common.save")}
          </Button>
        </div>

        {/* ── Git Parameters ──────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-muted/50 p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">
              {t("settings.config.gitParams.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.config.gitParams.desc")}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">
                {t("settings.config.gitParams.timeout")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("settings.config.gitParams.timeoutHint")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={5}
                max={300}
                value={gitParamsForm.timeoutSec}
                onChange={(e) =>
                  setGitParamsForm((f) => ({
                    ...f,
                    timeoutSec: Number(e.target.value),
                  }))
                }
                className="w-24 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
              />
              <span className="text-sm text-muted-foreground">s</span>
            </div>
          </div>
          <Button onClick={handleSaveGitParams} className="rounded-lg">
            {t("common.save")}
          </Button>
        </div>

        {/* ── Search Parameters ───────────────────────────────── */}
        <div className="rounded-xl border border-border bg-muted/50 p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">
              {t("settings.config.search.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.config.search.desc")}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium">
                  {t("settings.config.search.resultLimit")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.config.search.resultLimitHint")}
                </p>
              </div>
              <Input
                type="number"
                min={5}
                max={100}
                value={searchForm.resultLimit}
                onChange={(e) =>
                  setSearchForm((f) => ({
                    ...f,
                    resultLimit: Number(e.target.value),
                  }))
                }
                className="w-24 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium">
                  {t("settings.config.search.allModeCap")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.config.search.allModeCapHint")}
                </p>
              </div>
              <Input
                type="number"
                min={1}
                max={20}
                value={searchForm.allModeCap}
                onChange={(e) =>
                  setSearchForm((f) => ({
                    ...f,
                    allModeCap: Number(e.target.value),
                  }))
                }
                className="w-24 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium">
                  {t("settings.config.search.debounceMs")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.config.search.debounceMsHint")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={50}
                  max={1000}
                  value={searchForm.debounceMs}
                  onChange={(e) =>
                    setSearchForm((f) => ({
                      ...f,
                      debounceMs: Number(e.target.value),
                    }))
                  }
                  className="w-24 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
                />
                <span className="text-sm text-muted-foreground">ms</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium">
                  {t("settings.config.search.snippetLength")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.config.search.snippetLengthHint")}
                </p>
              </div>
              <Input
                type="number"
                min={20}
                max={500}
                value={searchForm.snippetLength}
                onChange={(e) =>
                  setSearchForm((f) => ({
                    ...f,
                    snippetLength: Number(e.target.value),
                  }))
                }
                className="w-24 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium">
                  {t("settings.config.search.codeTimeout")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.config.search.codeTimeoutHint")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={5}
                  max={300}
                  step={5}
                  value={searchForm.codeTimeoutSec}
                  onChange={(e) =>
                    setSearchForm((f) => ({
                      ...f,
                      codeTimeoutSec: Number(e.target.value),
                    }))
                  }
                  className="w-24 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
                />
                <span className="text-sm text-muted-foreground">s</span>
              </div>
            </div>
          </div>
          <Button onClick={handleSaveSearch} className="rounded-lg">
            {t("common.save")}
          </Button>
        </div>

        {/* ── Missions Grid Layout ────────────────────────────── */}
        <div className="rounded-xl border border-border bg-muted/50 p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">
              {t("settings.config.missions.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.config.missions.desc")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium flex-1">
                {t("settings.config.missions.minCols")}
              </label>
              <Input
                type="number"
                min={1}
                max={10}
                value={missionsGridForm.minCols}
                onChange={(e) =>
                  setMissionsGridForm((f) => ({
                    ...f,
                    minCols: Number(e.target.value),
                  }))
                }
                className="w-20 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium flex-1">
                {t("settings.config.missions.maxCols")}
              </label>
              <Input
                type="number"
                min={1}
                max={10}
                value={missionsGridForm.maxCols}
                onChange={(e) =>
                  setMissionsGridForm((f) => ({
                    ...f,
                    maxCols: Number(e.target.value),
                  }))
                }
                className="w-20 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium flex-1">
                {t("settings.config.missions.minRows")}
              </label>
              <Input
                type="number"
                min={1}
                max={10}
                value={missionsGridForm.minRows}
                onChange={(e) =>
                  setMissionsGridForm((f) => ({
                    ...f,
                    minRows: Number(e.target.value),
                  }))
                }
                className="w-20 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium flex-1">
                {t("settings.config.missions.maxRows")}
              </label>
              <Input
                type="number"
                min={1}
                max={10}
                value={missionsGridForm.maxRows}
                onChange={(e) =>
                  setMissionsGridForm((f) => ({
                    ...f,
                    maxRows: Number(e.target.value),
                  }))
                }
                className="w-20 text-right rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
          </div>
          <Button onClick={handleSaveMissionsGrid} className="rounded-lg">
            {t("common.save")}
          </Button>
        </div>

        {/* ── Hooks Configuration ─────────────────────────────── */}
        <div className="rounded-xl border border-border bg-muted/50 p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">
              {t("settings.config.hooks.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.config.hooks.desc")}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">
                {t("settings.config.hooks.autoUploadTypes")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("settings.config.hooks.autoUploadTypesHint")}
              </p>
            </div>
            <Input
              value={autoUploadTypes}
              onChange={(e) => setAutoUploadTypes(e.target.value)}
              placeholder="png, jpg, jpeg, gif, webp, svg, pdf"
              className="w-80 rounded-lg border-border/50 bg-muted/30 focus:ring-2 focus:ring-amber-500/30"
            />
          </div>
          <Button onClick={handleSaveAutoUploadTypes} className="rounded-lg">
            {t("common.save")}
          </Button>

          <div className="flex items-center gap-4 pt-4 border-t border-border/50">
            <div className="flex-1">
              <label className="text-sm font-medium">
                {hookStatus?.installed
                  ? t("settings.config.hooks.installed")
                  : t("settings.config.hooks.notInstalled")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("settings.config.hooks.installHint")}
              </p>
            </div>
            <Button
              variant={hookStatus?.installed ? "destructive" : "default"}
              onClick={handleToggleHook}
              disabled={hookLoading || !hookStatus}
              className="rounded-lg"
            >
              {hookStatus?.installed
                ? t("settings.config.hooks.uninstall")
                : t("settings.config.hooks.install")}
            </Button>
          </div>
        </div>

        {/* Delete Rule Confirmation Dialog */}
        <Dialog
          open={!!deleteRuleConfirmId}
          onOpenChange={(open) => !open && setDeleteRuleConfirmId(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("settings.config.git.deleteConfirm")}
              </DialogTitle>
              <DialogDescription>
                {t("settings.config.git.deleteConfirmMessage")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteRuleConfirmId(null)}
              >
                {t("settings.config.git.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  deleteRuleConfirmId && handleDeleteRule(deleteRuleConfirmId)
                }
              >
                {t("settings.config.git.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  function renderNotifications() {
    return (
      <div className="space-y-4">
        {/* 系统任务通知 */}
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">
            {t("settings.notifications.systemCategory")}
          </h3>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">
                {t("settings.notifications.enable")}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t("settings.notifications.enableDesc")}
              </div>
            </div>
            <Switch
              checked={notifEnabled}
              onCheckedChange={handleToggleNotif}
            />
          </div>
        </div>
        {/* 无人值守通知 */}
        <HarnessTargetsSection />
      </div>
    );
  }

  // =========================================================================
  // Section router
  // =========================================================================
  function renderSectionContent() {
    switch (activeSection) {
      case "general":
        return renderGeneral();
      case "ai-tools":
        return renderAiTools();
      case "prompts":
        return renderPrompts();
      case "config":
        return renderSystemConfig();
      case "notifications":
        return renderNotifications();
      case "backup":
        return <BackupSection />;
      case "extensions":
        return <ExtensionsSection />;
      case "keyboard-shortcuts":
        return <KeyboardShortcutsSection />;
    }
  }

  // =========================================================================
  // MAIN RENDER
  // =========================================================================
  return (
    <div className="flex h-full flex-col bg-background">
      {/* Top header bar */}
      <div className="flex-shrink-0 border-b bg-card/50 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-6">
          {/* Title row */}
          <div className="flex items-center justify-between pb-3 pt-5">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {t("settings.title")}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("settings.configDesc")}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleClose}
              className="gap-1.5 bg-card shadow-sm cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              ESC
            </Button>
          </div>

          {/* Horizontal tab navigation */}
          <div className="relative flex items-center gap-1">
            {canScrollTabsLeft && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => scrollTabs("left")}
                className="shrink-0"
                aria-label="scroll tabs left"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <div
              ref={tabsRef}
              className="relative flex flex-1 gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden"
            >
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              const accent = ACCENT_STYLES[section.accent];

              return (
                <button
                  key={section.id}
                  data-section={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "relative flex items-center gap-2 rounded-t-lg px-4 py-2.5",
                    "text-sm font-medium whitespace-nowrap cursor-pointer",
                    "transition-colors duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive
                      ? `${accent.text} bg-background`
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-md",
                      "transition-colors duration-200",
                      isActive ? accent.bg : "bg-transparent"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span>{t(section.labelKey)}</span>
                </button>
              );
            })}

            {/* Sliding active indicator */}
            <div
              className={cn(
                "absolute bottom-0 h-0.5 rounded-full",
                "transition-all duration-250 ease-out",
                accentStyle.indicator
              )}
              style={{
                left: indicatorStyle.left,
                width: indicatorStyle.width,
              }}
            />
            </div>
            {canScrollTabsRight && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => scrollTabs("right")}
                className="shrink-0"
                aria-label="scroll tabs right"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
          {/* Section header with colored icon badge */}
          {activeConfig && (
            <div className="mb-6 flex items-start gap-4">
              <div
                className={cn(
                  "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl",
                  "ring-1",
                  accentStyle.bg,
                  accentStyle.text,
                  accentStyle.ring
                )}
              >
                <activeConfig.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-tight">
                  {t(activeConfig.labelKey)}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t(activeConfig.descKey)}
                </p>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="mb-6 border-t" />

          {/* Config content */}
          {renderSectionContent()}
        </div>
      </div>

      {/* Folder picker for git rule template (shared by add / edit forms) */}
      <FolderBrowserDialog
        open={pickerTarget !== null}
        onOpenChange={(o) => { if (!o) setPickerTarget(null); }}
        onSelect={(selectedPath) => {
          // Serialize the Windows `\` pick to `/` so the field shows a clean,
          // template-consistent path immediately (no mixed `D:\code/owner`).
          const normalized = normalizeTemplateBasePath(selectedPath);
          if (pickerTarget === "add") {
            setAddRuleForm((f) => ({ ...f, localPathTemplate: normalized }));
          } else if (pickerTarget === "edit") {
            setEditRuleForm((f) => ({ ...f, localPathTemplate: normalized }));
          }
          setPickerTarget(null);
        }}
      />
    </div>
  );
}
