"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { GitBranch, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createVersion, updateVersion } from "@/actions/version-actions";
import { getVersionTypes } from "@/actions/version-type-actions";
import { getProjectBranches, fetchRemoteBranches } from "@/actions/git-actions";
import { ManageTypesDialog } from "@/components/version/manage-types-dialog";
import { useI18n } from "@/lib/i18n";

export interface VersionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceId: string;
  editVersion?: {
    id: string;
    number: string;
    name: string;
    typeId: string | null;
    baseBranch: string | null;
    startDate: Date | string | null;
    targetDate: Date | string | null;
    description: string | null;
  } | null;
  defaultBaseBranch?: string | null;
  projectLocalPath?: string | null;
  onSuccess?: () => void;
}

// ─── Date Helpers ────────────────────────────────────────────────────────────

function toDateInputValue(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function VersionFormDialog({
  open,
  onOpenChange,
  projectId,
  workspaceId,
  editVersion,
  defaultBaseBranch,
  projectLocalPath,
  onSuccess,
}: VersionFormDialogProps) {
  const { t } = useI18n();
  const isEditMode = !!editVersion;

  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState<string>("");
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [description, setDescription] = useState("");
  const [setCurrent, setSetCurrent] = useState(false);

  // Branch picker
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const isGitProject = !!projectLocalPath;

  const [isPending, startTransition] = useTransition();

  // Reset / prefill fields when dialog opens or editVersion changes
  useEffect(() => {
    if (!open) return;

    if (editVersion) {
      setNumber(editVersion.number);
      setName(editVersion.name);
      setTypeId(editVersion.typeId ?? "");
      setBaseBranch(editVersion.baseBranch ?? "");
      setStartDate(toDateInputValue(editVersion.startDate));
      setTargetDate(toDateInputValue(editVersion.targetDate));
      setDescription(editVersion.description ?? "");
      setSetCurrent(false);
    } else {
      setNumber("");
      setName("");
      setTypeId("");
      setBaseBranch(defaultBaseBranch ?? "");
      setStartDate("");
      setTargetDate("");
      setDescription("");
      setSetCurrent(false);
    }
  }, [open, editVersion, defaultBaseBranch]);

  // Load workspace version types when dialog opens
  useEffect(() => {
    if (!open) return;
    getVersionTypes(workspaceId).then(setTypes).catch(() => setTypes([]));
  }, [open, workspaceId]);

  // Load git branches when dialog opens (cached first, then refresh remote)
  useEffect(() => {
    if (!open || !isGitProject) {
      setBranches([]);
      return;
    }
    setBranchesLoading(true);
    getProjectBranches(projectLocalPath!)
      .then(setBranches)
      .catch(() => setBranches([]))
      .finally(() => setBranchesLoading(false));
    fetchRemoteBranches(projectLocalPath!)
      .then(() => getProjectBranches(projectLocalPath!).then(setBranches))
      .catch(() => {});
  }, [open, isGitProject, projectLocalPath]);

  const handleSubmit = () => {
    if (!number.trim() || !name.trim()) return;

    startTransition(async () => {
      try {
        if (isEditMode && editVersion) {
          await updateVersion(editVersion.id, {
            number: number.trim(),
            name: name.trim(),
            typeId: typeId || null,
            baseBranch: baseBranch.trim() || null,
            startDate: parseDateInput(startDate) ?? null,
            targetDate: parseDateInput(targetDate) ?? null,
            description: description.trim() || null,
          });
        } else {
          await createVersion({
            projectId,
            number: number.trim(),
            name: name.trim(),
            typeId: typeId || undefined,
            baseBranch: baseBranch.trim() || undefined,
            startDate: parseDateInput(startDate),
            targetDate: parseDateInput(targetDate),
            description: description.trim() || undefined,
            setCurrent,
          });
        }

        toast.success(isEditMode ? t("version.edit") : t("version.new"));
        onOpenChange(false);
        onSuccess?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? t("version.edit") : t("version.new")}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Number */}
          <div className="grid gap-1.5">
            <Label htmlFor="version-number">
              {t("version.field.number")}
              <span className="text-destructive ml-0.5">*</span>
            </Label>
            <Input
              id="version-number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder={t("version.placeholder.number")}
              disabled={isPending}
            />
          </div>

          {/* Name */}
          <div className="grid gap-1.5">
            <Label htmlFor="version-name">
              {t("version.field.name")}
              <span className="text-destructive ml-0.5">*</span>
            </Label>
            <Input
              id="version-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("version.placeholder.name")}
              disabled={isPending}
            />
          </div>

          {/* Type */}
          <div className="grid gap-1.5">
            <Label>{t("version.field.type")}</Label>
            <Select
              value={typeId || "__none__"}
              onValueChange={(v) => {
                setTypeId(!v || v === "__none__" ? "" : v);
              }}
            >
              <SelectTrigger className="w-full" disabled={isPending}>
                <span className="truncate">
                  {typeId
                    ? (types.find((tp) => tp.id === typeId)?.name ?? t("version.type.uncategorized"))
                    : t("version.type.uncategorized")}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  {t("version.type.uncategorized")}
                </SelectItem>
                {types.map((tp) => (
                  <SelectItem key={tp.id} value={tp.id}>
                    {tp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto justify-start px-0 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setManageOpen(true)}
              disabled={isPending}
            >
              ＋ {t("version.manageTypes")}
            </Button>
          </div>

          {/* Base Branch — git branch picker for git projects, text fallback otherwise */}
          <div className="grid gap-1.5">
            <Label>{t("version.field.baseBranch")}</Label>
            {branchesLoading ? (
              <div className="text-sm text-muted-foreground">{t("task.branchLoading")}</div>
            ) : isGitProject && branches.length > 0 ? (
              <Popover open={branchOpen} onOpenChange={setBranchOpen}>
                <PopoverTrigger
                  className="flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-3 text-sm transition-colors hover:bg-accent focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  disabled={isPending}
                  data-testid="version-branch-selector"
                >
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className={`flex-1 truncate text-left text-xs ${baseBranch ? "font-mono" : "text-muted-foreground"}`}>
                    {baseBranch || t("version.field.noBranch")}
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t("task.branchSearch")} />
                    <CommandList>
                      <CommandEmpty>{t("task.branchNone")}</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__none__"
                          onSelect={() => { setBaseBranch(""); setBranchOpen(false); }}
                        >
                          <span className="flex-1 truncate text-muted-foreground">
                            {t("version.field.noBranch")}
                          </span>
                          {!baseBranch && <Check className="ml-auto h-3 w-3 shrink-0 text-primary" />}
                        </CommandItem>
                        {branches.map((branch) => (
                          <CommandItem
                            key={branch}
                            value={branch}
                            onSelect={() => { setBaseBranch(branch); setBranchOpen(false); }}
                          >
                            <GitBranch className="mr-2 h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate font-mono">{branch}</span>
                            {branch === baseBranch && <Check className="ml-auto h-3 w-3 shrink-0 text-primary" />}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <Input
                id="version-base-branch"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                placeholder="main"
                disabled={isPending}
              />
            )}
          </div>

          {/* Start Date / Target Date — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="version-start-date">
                {t("version.field.startDate")}
              </Label>
              <input
                id="version-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isPending}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="version-target-date">
                {t("version.field.targetDate")}
              </Label>
              <input
                id="version-target-date"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                disabled={isPending}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>

          {/* Description */}
          <div className="grid gap-1.5">
            <Label htmlFor="version-description">
              {t("version.field.description")}
            </Label>
            <Textarea
              id="version-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={isPending}
            />
          </div>

          {/* Set Current — create mode only */}
          {!isEditMode && (
            <div className="flex items-center gap-3">
              <Switch
                id="version-set-current"
                checked={setCurrent}
                onCheckedChange={setSetCurrent}
                disabled={isPending}
              />
              <Label htmlFor="version-set-current" className="cursor-pointer">
                {t("version.field.setCurrent")}
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !number.trim() || !name.trim()}
          >
            {isEditMode ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>

      <ManageTypesDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        workspaceId={workspaceId}
        onChanged={() => getVersionTypes(workspaceId).then(setTypes)}
      />
    </Dialog>
  );
}
