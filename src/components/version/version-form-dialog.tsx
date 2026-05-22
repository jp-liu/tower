"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createVersion, updateVersion } from "@/actions/version-actions";
import { useI18n } from "@/lib/i18n";

type VersionType = "FEATURE" | "BUGFIX" | "RESEARCH";

export interface VersionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  editVersion?: {
    id: string;
    number: string;
    name: string;
    type: VersionType;
    baseBranch: string | null;
    startDate: Date | string | null;
    targetDate: Date | string | null;
    description: string | null;
  } | null;
  defaultBaseBranch?: string | null;
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
  editVersion,
  defaultBaseBranch,
  onSuccess,
}: VersionFormDialogProps) {
  const { t } = useI18n();
  const isEditMode = !!editVersion;

  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<VersionType>("FEATURE");
  const [baseBranch, setBaseBranch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [description, setDescription] = useState("");
  const [setCurrent, setSetCurrent] = useState(false);

  const [isPending, startTransition] = useTransition();

  // Reset / prefill fields when dialog opens or editVersion changes
  useEffect(() => {
    if (!open) return;

    if (editVersion) {
      setNumber(editVersion.number);
      setName(editVersion.name);
      setType(editVersion.type);
      setBaseBranch(editVersion.baseBranch ?? "");
      setStartDate(toDateInputValue(editVersion.startDate));
      setTargetDate(toDateInputValue(editVersion.targetDate));
      setDescription(editVersion.description ?? "");
      setSetCurrent(false);
    } else {
      setNumber("");
      setName("");
      setType("FEATURE");
      setBaseBranch(defaultBaseBranch ?? "");
      setStartDate("");
      setTargetDate("");
      setDescription("");
      setSetCurrent(false);
    }
  }, [open, editVersion, defaultBaseBranch]);

  const handleSubmit = () => {
    if (!number.trim() || !name.trim()) return;

    startTransition(async () => {
      try {
        if (isEditMode && editVersion) {
          await updateVersion(editVersion.id, {
            number: number.trim(),
            name: name.trim(),
            type,
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
            type,
            baseBranch: baseBranch.trim() || undefined,
            startDate: parseDateInput(startDate),
            targetDate: parseDateInput(targetDate),
            description: description.trim() || undefined,
            setCurrent,
          });
        }

        toast.success(
          isEditMode
            ? t("version.edit")
            : t("version.new")
        );
        onOpenChange(false);
        onSuccess?.();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : String(err)
        );
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
              value={type}
              onValueChange={(v) => {
                if (v) setType(v as VersionType);
              }}
            >
              <SelectTrigger className="w-full" disabled={isPending}>
                <span>{t(`version.type.${type}`)}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FEATURE">
                  {t("version.type.FEATURE")}
                </SelectItem>
                <SelectItem value="BUGFIX">
                  {t("version.type.BUGFIX")}
                </SelectItem>
                <SelectItem value="RESEARCH">
                  {t("version.type.RESEARCH")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Base Branch */}
          <div className="grid gap-1.5">
            <Label htmlFor="version-base-branch">
              {t("version.field.baseBranch")}
            </Label>
            <Input
              id="version-base-branch"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder="main"
              disabled={isPending}
            />
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
    </Dialog>
  );
}
