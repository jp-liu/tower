"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";
import { getWorkspacesWithProjects } from "@/actions/workspace-actions";
import {
  getLabelsForWorkspace,
  createLabel,
  deleteLabel,
  updateLabelBranchPrefix,
} from "@/actions/label-actions";
import { isValidBranchPrefix, DEFAULT_BRANCH_PREFIX } from "@/lib/worktree-branch";

/** Same palette the sidebar label manager used before this moved here. */
const LABEL_COLORS = ["#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

/** A label is system-level when it belongs to no workspace. */
type Level = "system" | "workspace";

interface LabelItem {
  id: string;
  name: string;
  color: string;
  workspaceId: string | null;
  isBuiltin: boolean;
  branchPrefix: string | null;
}

interface WorkspaceOption {
  id: string;
  name: string;
}

/**
 * Label management: create/delete labels, choose their level (system-wide vs.
 * one workspace), and give each a worktree branch prefix.
 *
 * Scoped by a workspace picker because "workspace-level" only means anything
 * relative to one workspace — the table shows system-level labels plus the
 * selected workspace's, exactly what `getLabelsForWorkspace` returns and what a
 * task in that workspace can actually pick.
 *
 * Builtin labels (just Tower, Tower's own machine marker on workbench tasks)
 * are read-only here: no delete, no prefix, no level change.
 */
export function LabelsSection() {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [defaultPrefix, setDefaultPrefix] = useState(DEFAULT_BRANCH_PREFIX);

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(LABEL_COLORS[0]);
  // Stored as a level, not a workspace id: the id is read from `workspaceId` at
  // create time, so switching workspaces can never file a label under a stale one.
  const [newLevel, setNewLevel] = useState<Level>("system");

  useEffect(() => {
    getWorkspacesWithProjects().then((list) => {
      setWorkspaces(list.map((ws) => ({ id: ws.id, name: ws.name })));
      setWorkspaceId((current) => current || list[0]?.id || "");
    });
    getConfigValue<string>("git.defaultWorktreeBranchPrefix", DEFAULT_BRANCH_PREFIX).then(
      setDefaultPrefix
    );
  }, []);

  const reload = useCallback(async () => {
    if (!workspaceId) return;
    setLabels((await getLabelsForWorkspace(workspaceId)) as LabelItem[]);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    getLabelsForWorkspace(workspaceId).then((list) => setLabels(list as LabelItem[]));
  }, [workspaceId]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await createLabel({
      name: newName.trim(),
      color: newColor,
      workspaceId: newLevel === "system" ? null : workspaceId,
    });
    setNewName("");
    await reload();
  };

  const handleDelete = async (id: string) => {
    await deleteLabel(id);
    setLabels((prev) => prev.filter((l) => l.id !== id));
  };

  const patchPrefix = (id: string, branchPrefix: string) =>
    setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, branchPrefix } : l)));

  const handlePrefixBlur = async (label: LabelItem) => {
    const prefix = label.branchPrefix?.trim() ?? "";
    if (prefix && !isValidBranchPrefix(prefix)) {
      toast.error(t("settings.config.labels.invalidPrefix"));
      return; // reject the save, keep the text so the user can fix it
    }
    try {
      await updateLabelBranchPrefix(label.id, prefix || null);
    } catch {
      toast.error(t("settings.config.labels.saveFailed"));
      await reload();
    }
  };

  const handleDefaultPrefixBlur = async () => {
    const prefix = defaultPrefix.trim();
    if (!isValidBranchPrefix(prefix)) {
      toast.error(t("settings.config.labels.invalidPrefix"));
      return;
    }
    await setConfigValue("git.defaultWorktreeBranchPrefix", prefix);
    toast.success(t("settings.config.labels.defaultPrefixSaved"));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("settings.config.labels.title")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("settings.config.labels.desc")}
          </p>
        </div>
        <Select value={workspaceId} onValueChange={(v) => setWorkspaceId(v as string)}>
          <SelectTrigger className="w-52 shrink-0">
            <span className="truncate">
              {workspaces.find((w) => w.id === workspaceId)?.name ??
                t("settings.config.labels.pickWorkspace")}
            </span>
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((ws) => (
              <SelectItem key={ws.id} value={ws.id}>
                {ws.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ul className="divide-y rounded-xl border border-border bg-card">
        {labels.map((label) => (
          <li key={label.id} className="flex items-center gap-3 px-5 py-3">
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: label.color }}
            />
            <span className="w-40 shrink-0 truncate text-sm">{label.name}</span>

            <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
              {t(
                label.workspaceId === null
                  ? "settings.config.labels.levelSystem"
                  : "settings.config.labels.levelWorkspace"
              )}
              {label.isBuiltin ? ` · ${t("settings.config.labels.builtin")}` : ""}
            </Badge>

            {label.isBuiltin ? (
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                {t("settings.config.labels.builtinReadonly")}
              </p>
            ) : (
              <>
                <Input
                  value={label.branchPrefix ?? ""}
                  onChange={(e) => patchPrefix(label.id, e.target.value)}
                  onBlur={() => void handlePrefixBlur(label)}
                  placeholder={t("settings.config.labels.prefixPlaceholder")}
                  aria-invalid={Boolean(label.branchPrefix) && !isValidBranchPrefix(label.branchPrefix!)}
                  className="w-40 shrink-0 font-mono text-sm"
                />
                <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {`${label.branchPrefix?.trim() || defaultPrefix}/`}
                  {t("settings.config.labels.taskIdPlaceholder")}
                </p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void handleDelete(label.id)}
                  className="shrink-0 text-destructive"
                  title={t("settings.config.labels.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </li>
        ))}

        {/* Add a label */}
        <li className="flex items-center gap-3 px-5 py-3 bg-muted/20">
          <div className="flex shrink-0 gap-1.5">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                aria-label={c}
                className={cn(
                  "size-4 rounded-full transition-all cursor-pointer",
                  newColor === c && "ring-2 ring-offset-2 ring-offset-background ring-foreground/30 scale-110"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAdd();
              }
            }}
            placeholder={t("settings.config.labels.namePlaceholder")}
            className="w-40 shrink-0 text-sm"
          />
          <Select value={newLevel} onValueChange={(v) => setNewLevel(v as Level)}>
            <SelectTrigger className="w-40 shrink-0">
              <span className="truncate">
                {t(
                  newLevel === "system"
                    ? "settings.config.labels.levelSystem"
                    : "settings.config.labels.levelWorkspace"
                )}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("settings.config.labels.levelSystem")}</SelectItem>
              <SelectItem value="workspace">{t("settings.config.labels.levelWorkspace")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button onClick={() => void handleAdd()} disabled={!newName.trim() || !workspaceId}>
            <Plus className="mr-2 h-4 w-4" />
            {t("settings.config.labels.add")}
          </Button>
        </li>
      </ul>

      {/* Fallback prefix for tasks whose labels carry none */}
      <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-3">
        <div className="min-w-0 flex-1">
          <label className="text-sm font-medium">
            {t("settings.config.labels.defaultPrefix")}
          </label>
          <p className="text-xs text-muted-foreground">
            {t("settings.config.labels.defaultPrefixHint")}
          </p>
        </div>
        <Input
          value={defaultPrefix}
          onChange={(e) => setDefaultPrefix(e.target.value)}
          onBlur={() => void handleDefaultPrefixBlur()}
          aria-invalid={!isValidBranchPrefix(defaultPrefix)}
          className="w-40 shrink-0 font-mono text-sm"
        />
      </div>
    </div>
  );
}
