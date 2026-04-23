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
import { GitBranch, Check, ChevronsUpDown } from "lucide-react";
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
import type { Task, Priority, TaskStatus } from "@prisma/client";

interface LabelOption {
  id: string;
  name: string;
  color: string;
  isBuiltin: boolean;
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
  }) => void;
  onUpdate?: (taskId: string, data: {
    title: string;
    description: string;
    priority: Priority;
    labelIds: string[];
    subPath?: string;
  }) => void;
  defaultStatus?: TaskStatus;
  editTask?: Task | null;
  editTaskLabelIds?: string[];
  labels: LabelOption[];
  projectType?: string;
  projectLocalPath?: string | null;
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  onSubmit,
  onUpdate,
  defaultStatus = "TODO",
  editTask,
  editTaskLabelIds,
  labels,
  projectType: _projectType,
  projectLocalPath,
}: CreateTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [subPath, setSubPath] = useState("");
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [useWorktree, setUseWorktree] = useState(true);
  const { t } = useI18n();

  const isEditing = !!editTask;
  const isGitProject = !!projectLocalPath;

  // Pre-fill when editing
  useEffect(() => {
    if (editTask) {
      setTitle(editTask.title);
      setDescription(editTask.description ?? "");
      setPriority(editTask.priority);
      setSubPath(editTask.subPath ?? "");
      setSelectedLabelIds(editTaskLabelIds ?? []);
    } else {
      setTitle("");
      setDescription("");
      setPriority("MEDIUM");
      setSubPath("");
      setSelectedLabelIds([]);
    }
  }, [editTask, editTaskLabelIds]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open && !editTask) {
      setTitle("");
      setDescription("");
      setPriority("MEDIUM");
      setSubPath("");
      setSelectedLabelIds([]);
      setBranches([]);
      setSelectedBranch("");
      setBranchOpen(false);
    }
  }, [open, editTask]);

  // Load branches instantly from cache, then refresh after background fetch
  useEffect(() => {
    if (!open || !isGitProject || editTask) return;
    setBranchesLoading(true);
    // 1. Load cached branches + current branch immediately (no network)
    Promise.all([
      getProjectBranches(projectLocalPath!),
      getCurrentBranch(projectLocalPath!),
    ]).then(([list, current]) => {
      setBranches(list);
      // Default to current active branch, fallback to first
      setSelectedBranch(current && list.includes(current) ? current : list[0] ?? "");
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
  }, [open, isGitProject, projectLocalPath, editTask]);

  const handleSubmit = () => {
    if (!title.trim()) return;
    if (isEditing && onUpdate) {
      onUpdate(editTask.id, { title, description, priority, labelIds: selectedLabelIds, subPath: subPath.trim() || "" });
    } else {
      onSubmit({
        title,
        description,
        priority,
        status: defaultStatus,
        labelIds: selectedLabelIds,
        ...(isGitProject && useWorktree && selectedBranch ? { baseBranch: selectedBranch } : {}),
        ...(subPath.trim() ? { subPath: subPath.trim() } : {}),
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
                    <span className="flex-1 truncate text-left text-xs">{selectedBranch || t("task.branchNone")}</span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </PopoverTrigger>
                  <PopoverContent className="p-0" align="start">
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
                              <span className="flex-1 truncate font-mono">{branch}</span>
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
            </div>
          )}
          {/* Labels */}
          {labels.length > 0 && (
            <div className="space-y-2">
              <Label>{t("task.labels")}</Label>
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
