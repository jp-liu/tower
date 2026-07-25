"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { GitBranch, Check, ChevronsUpDown, Tags } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useI18n } from "@/lib/i18n";
import { getProjectBranches, fetchRemoteBranches, getCurrentBranch } from "@/actions/git-actions";
import { getConfigValues } from "@/actions/config-actions";
import type { Task, Priority, TaskStatus } from "@prisma/client";

/** Settings page, Config tab, scrolled to the labels block (see settings-page.tsx). */
const SETTINGS_LABELS_HREF = "/settings?section=config#labels";

interface LabelOption {
  id: string;
  name: string;
  color: string;
  isBuiltin: boolean;
}

interface VersionOption {
  id: string;
  number: string;
  name: string;
  isCurrent: boolean;
  status: string;
}

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    title: string;
    description: string;
    priority: Priority;
    status: TaskStatus;
    labelIds: string[];
    baseBranch?: string;
    subPath?: string;
    versionId?: string | null;
    autoStart?: boolean;
  }) => void;
  onUpdate?: (taskId: string, data: {
    title: string;
    description: string;
    priority: Priority;
    labelIds: string[];
    subPath?: string;
    versionId?: string | null;
  }) => void;
  defaultStatus?: TaskStatus;
  editTask?: Task | null;
  editTaskLabelIds?: string[];
  /**
   * Pre-fill the create form with another task's data (used by "duplicate task"
   * from archive drawer). Only applied when `editTask` is null/undefined.
   */
  prefillFromTask?: {
    title?: string;
    description?: string | null;
    priority?: Priority;
    subPath?: string | null;
    labelIds?: string[];
    baseBranch?: string | null;
  } | null;
  labels: LabelOption[];
  projectType?: string;
  projectLocalPath?: string | null;
  /** Available versions for the version picker (optional; omit to hide picker) */
  versions?: VersionOption[];
  /** Default version to pre-select in create mode */
  defaultVersionId?: string | null;
}

export function CreateTaskDialog(props: CreateTaskDialogProps) {
  const formKey = [
    props.open ? "open" : "closed",
    props.editTask?.id ?? "new",
    props.projectLocalPath ?? "normal",
  ].join(":");
  return <CreateTaskDialogState key={formKey} {...props} />;
}

function CreateTaskDialogState({
  open,
  onOpenChange,
  onSubmit,
  onUpdate,
  defaultStatus = "TODO",
  editTask,
  editTaskLabelIds,
  prefillFromTask,
  labels,
  projectType: _projectType,
  projectLocalPath,
  versions,
  defaultVersionId,
}: CreateTaskDialogProps) {
  const [title, setTitle] = useState(editTask?.title ?? prefillFromTask?.title ?? "");
  const [description, setDescription] = useState(
    editTask?.description ?? prefillFromTask?.description ?? "",
  );
  const [priority, setPriority] = useState<Priority>(
    editTask?.priority ?? prefillFromTask?.priority ?? "MEDIUM",
  );
  const [subPath, setSubPath] = useState(editTask?.subPath ?? prefillFromTask?.subPath ?? "");
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(
    editTask ? (editTaskLabelIds ?? []) : (prefillFromTask?.labelIds ?? []),
  );
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(
    open && !!projectLocalPath && !editTask,
  );
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [useWorktree, setUseWorktree] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    editTask?.versionId ?? defaultVersionId ?? null,
  );
  const { t } = useI18n();

  // Load task creation defaults (worktree / auto-start) from system config.
  // Runs once when the dialog opens in *create* mode — edit mode never starts
  // executions or toggles worktree, so it doesn't need to refresh these.
  useEffect(() => {
    if (!open || editTask) return;
    let cancelled = false;
    getConfigValues(["task.defaultUseWorktree", "task.defaultAutoStart"])
      .then((cfg) => {
        if (cancelled) return;
        const wt = cfg["task.defaultUseWorktree"];
        const as = cfg["task.defaultAutoStart"];
        if (typeof wt === "boolean") setUseWorktree(wt);
        if (typeof as === "boolean") setAutoStart(as);
      })
      .catch(() => { /* keep hard-coded defaults */ });
    return () => { cancelled = true; };
  }, [open, editTask]);

  const isEditing = !!editTask;
  const isGitProject = !!projectLocalPath;

  // Load branches instantly from cache, then refresh after background fetch
  useEffect(() => {
    if (!open || !isGitProject || editTask) return;
    // 1. Load cached branches + current branch immediately (no network)
    Promise.all([
      getProjectBranches(projectLocalPath!),
      getCurrentBranch(projectLocalPath!),
    ]).then(([list, current]) => {
      setBranches(list);
      // Branch selection priority:
      //   1. prefillFromTask.baseBranch (only if it still exists locally)
      //   2. current active branch
      //   3. first available
      // If a prefilled branch is no longer in the list, fall through so the user
      // can pick something — they'll see the dropdown defaulted to current branch.
      const prefilledBranch = prefillFromTask?.baseBranch ?? null;
      if (prefilledBranch && list.includes(prefilledBranch)) {
        setSelectedBranch(prefilledBranch);
      } else {
        setSelectedBranch(current && list.includes(current) ? current : list[0] ?? "");
      }
      setBranchesLoading(false);
      // 2. Trigger background git fetch, then refresh list
      fetchRemoteBranches(projectLocalPath!).then(() => {
        // Wait a moment for fetch to complete, then reload
        setTimeout(() => {
          getProjectBranches(projectLocalPath!).then((updated) => {
            setBranches(updated);
            // Keep selection if still valid, otherwise pick first
            setSelectedBranch((prev) => updated.includes(prev) ? prev : updated[0] ?? "");
          }).catch(() => {});
        }, 3000);
      });
    }).catch(() => {
      setBranches([]);
      setSelectedBranch("");
      setBranchesLoading(false);
    });
  }, [open, isGitProject, projectLocalPath, editTask, prefillFromTask]);

  const handleSubmit = () => {
    if (!title.trim()) return;
    if (isEditing && onUpdate) {
      onUpdate(editTask.id, {
        title,
        description,
        priority,
        labelIds: selectedLabelIds,
        subPath: subPath.trim() || "",
        versionId: selectedVersionId,
      });
    } else {
      onSubmit({
        title,
        description,
        priority,
        status: defaultStatus,
        labelIds: selectedLabelIds,
        ...(isGitProject && useWorktree && selectedBranch ? { baseBranch: selectedBranch } : {}),
        ...(subPath.trim() ? { subPath: subPath.trim() } : {}),
        versionId: selectedVersionId,
        autoStart,
      });
    }
    setTitle("");
    setDescription("");
    setPriority("MEDIUM");
    setSubPath("");
    setSelectedLabelIds([]);
    setBranches([]);
    setSelectedBranch("");
    setUseWorktree(true);
    setSelectedVersionId(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? t("task.edit") : t("task.create")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="title">{t("task.title")}</Label>
            <Input
              id="title"
              data-testid="task-title"
              placeholder={t("task.titlePlaceholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">{t("task.description")}</Label>
            <Textarea
              id="description"
              placeholder={t("task.descPlaceholder")}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="max-h-[200px] overflow-y-auto"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subPath">{t("task.subPath")}</Label>
            <Input
              id="subPath"
              placeholder={t("task.subPathPlaceholder")}
              value={subPath}
              onChange={(e) => setSubPath(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("task.subPathHint")}</p>
          </div>
          {/* Priority - Button Group instead of Select */}
          <div className="space-y-2">
            <Label>{t("task.priority")}</Label>
            <div className="flex gap-1.5">
              {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((p) => {
                const config = {
                  LOW: { label: t("task.priorityLow"), style: "text-slate-300 border-slate-500/30 bg-slate-500/10" },
                  MEDIUM: { label: t("task.priorityMedium"), style: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
                  HIGH: { label: t("task.priorityHigh"), style: "text-orange-300 border-orange-500/30 bg-orange-500/10" },
                  CRITICAL: { label: t("task.priorityCritical"), style: "text-rose-300 border-rose-500/30 bg-rose-500/10" },
                }[p];
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                      priority === p
                        ? `${config.style} ring-1 ring-current/20`
                        : "border-border text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {config.label}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Base Branch Selector - only for GIT projects in create mode */}
          {isGitProject && !isEditing && (
            <div className="space-y-2">
              <Label>{t("task.baseBranch")}</Label>
              {branchesLoading ? (
                <div className="text-sm text-muted-foreground">{t("task.branchLoading")}</div>
              ) : branches.length > 0 ? (
                <Popover open={branchOpen} onOpenChange={setBranchOpen}>
                  <PopoverTrigger
                    className="flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono transition-colors hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
                    data-testid="branch-selector"
                  >
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span
                      className="flex-1 truncate text-left text-xs"
                      title={selectedBranch || undefined}
                    >
                      {selectedBranch || t("task.branchNone")}
                    </span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </PopoverTrigger>
                  <PopoverContent className="w-[min(32rem,90vw)] p-0" align="start">
                    <Command>
                      <CommandInput placeholder={t("task.branchSearch")} />
                      <CommandList>
                        <CommandEmpty>{t("task.branchNone")}</CommandEmpty>
                        <CommandGroup>
                          {branches.map((branch) => (
                            <CommandItem
                              key={branch}
                              value={branch}
                              onSelect={() => { setSelectedBranch(branch); setBranchOpen(false); }}
                            >
                              <GitBranch className="h-3 w-3 text-muted-foreground shrink-0 mr-2" />
                              <span className="flex-1 truncate font-mono" title={branch}>{branch}</span>
                              {branch === selectedBranch && <Check className="h-3 w-3 text-primary shrink-0 ml-auto" />}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              ) : (
                <div className="text-sm text-muted-foreground">{t("task.branchNone")}</div>
              )}
              {/* Worktree toggle */}
              <div className="mt-3 flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">{t("task.worktreeLabel")}</Label>
                <div className="flex gap-1">
                  {([true, false] as const).map((val) => (
                    <button
                      key={String(val)}
                      type="button"
                      onClick={() => setUseWorktree(val)}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        useWorktree === val
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {val ? t("task.worktreeYes") : t("task.worktreeNo")}
                    </button>
                  ))}
                </div>
              </div>
              {/* Auto-start toggle */}
              <div className="mt-2 flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">{t("task.autoStartLabel")}</Label>
                <div className="flex gap-1">
                  {([true, false] as const).map((val) => (
                    <button
                      key={String(val)}
                      type="button"
                      onClick={() => setAutoStart(val)}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        autoStart === val
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {val ? t("task.autoStartYes") : t("task.autoStartNo")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* Labels — the only place a task picks up a branch prefix, so when
              there are none, sell the idea rather than hiding the section. */}
          {labels.length === 0 ? (
            <div className="space-y-2">
              <Label>{t("task.labels")}</Label>
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3">
                <p className="text-sm font-medium">{t("task.labelsEmptyTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("task.labelsEmptyDesc")}
                </p>
                <Button
                  variant="outline"
                  className="mt-2.5"
                  render={<Link href={SETTINGS_LABELS_HREF} />}
                >
                  <Tags className="mr-2 h-3.5 w-3.5" />
                  {t("task.labelsEmptyCta")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{t("task.labels")}</Label>
                <Button
                  variant="ghost"
                  className="h-7 px-2 text-muted-foreground"
                  render={<Link href={SETTINGS_LABELS_HREF} />}
                >
                  <Tags className="mr-1.5 h-3.5 w-3.5" />
                  <span className="text-xs">{t("task.manageLabels")}</span>
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {labels.map((label) => {
                  const isSelected = selectedLabelIds.includes(label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => {
                        setSelectedLabelIds((prev) =>
                          isSelected ? prev.filter((id) => id !== label.id) : [...prev, label.id]
                        );
                      }}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                        isSelected
                          ? "ring-1 ring-current/30"
                          : "opacity-50 hover:opacity-80"
                      }`}
                      style={{
                        backgroundColor: label.color + "20",
                        color: label.color,
                        borderColor: isSelected ? label.color + "40" : "transparent",
                        borderWidth: "1px",
                      }}
                    >
                      {label.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* Version Picker — always shown in create mode (discoverability);
              in edit mode only when the project has versions. When the project
              has no versions yet, show a hint instead of an empty dropdown. */}
          {(!isEditing || (versions && versions.length > 0)) && (
            <div className="space-y-2">
              <Label>{t("version.picker.label")}</Label>
              {versions && versions.length > 0 ? (
                <Select
                  value={selectedVersionId ?? "__none__"}
                  onValueChange={(val) => setSelectedVersionId(val === "__none__" ? null : val)}
                >
                  <SelectTrigger>
                    <span className="truncate text-sm">
                      {selectedVersionId
                        ? (() => {
                            const v = versions.find((ver) => ver.id === selectedVersionId);
                            if (!v) return t("version.picker.none");
                            return v.isCurrent
                              ? `${v.number} · ${v.name} · ${t("version.currentShort")}`
                              : `${v.number} · ${v.name}`;
                          })()
                        : t("version.picker.none")}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("version.picker.none")}</SelectItem>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.isCurrent
                          ? `${v.number} · ${v.name} · ${t("version.currentShort")}`
                          : `${v.number} · ${v.name}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  {t("version.picker.empty")}
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            className="bg-primary/10 text-primary ring-1 ring-primary/20 hover:bg-primary/15"
          >
            {isEditing ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
