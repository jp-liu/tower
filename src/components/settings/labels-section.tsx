"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";
import { getWorkspacesWithProjects } from "@/actions/workspace-actions";
import {
  getLabelsForWorkspace,
  createLabel,
  deleteLabel,
  updateLabel,
} from "@/actions/label-actions";
import { isValidBranchPrefix, DEFAULT_BRANCH_PREFIX } from "@/lib/worktree-branch";

/** Same palette the sidebar label manager used before this moved here. */
const LABEL_COLORS = ["#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

const randomColor = () => LABEL_COLORS[Math.floor(Math.random() * LABEL_COLORS.length)];

/** Matches createLabelSchema — keep both in step. */
const MAX_LABEL_NAME = 50;

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

/** Color swatch that opens the palette in a popover. */
function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Sized like the static dots of the rows above so the name inputs stay in
          one column; `after` widens the hit area without widening the layout. */}
      <PopoverTrigger
        aria-label={t("settings.config.labels.pickColor")}
        title={t("settings.config.labels.pickColor")}
        className="relative size-3 shrink-0 cursor-pointer rounded-full ring-offset-2 ring-offset-background after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
        style={{ backgroundColor: value }}
      />
      <PopoverContent align="start" className="w-auto flex-row gap-1.5">
        {LABEL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              onChange(c);
              setOpen(false);
            }}
            aria-label={c}
            className={cn(
              "size-5 cursor-pointer rounded-full transition-all",
              value === c && "ring-2 ring-foreground/30 ring-offset-2 ring-offset-popover"
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Trailing row of a label group: pick a color, type a name, add. */
function AddLabelRow({
  addLabel,
  onAdd,
  disabled,
}: {
  addLabel: string;
  onAdd: (name: string, color: string) => Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  // Randomized on mount, not in the initializer: this is server rendered too, and
  // a color picked twice would be a hydration mismatch.
  const [color, setColor] = useState(LABEL_COLORS[0]);

  useEffect(() => setColor(randomColor()), []);

  const submit = async () => {
    if (!name.trim() || disabled) return;
    await onAdd(name.trim(), color);
    setName("");
    setColor(randomColor());
  };

  return (
    <li className="flex items-center gap-3 bg-muted/20 px-5 py-3">
      <ColorPicker value={color} onChange={setColor} />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        maxLength={MAX_LABEL_NAME}
        placeholder={t("settings.config.labels.namePlaceholder")}
        className="w-40 shrink-0 text-sm"
      />
      <div className="flex-1" />
      <Button onClick={() => void submit()} disabled={!name.trim() || disabled}>
        <Plus className="mr-2 h-4 w-4" />
        {addLabel}
      </Button>
    </li>
  );
}

/**
 * Label management, grouped by reach:
 *
 * - System labels (`workspaceId: null`) are usable from every workspace.
 * - Workspace labels belong to the workspace picked next to that group's title.
 *
 * Both kinds are the user's own: name, worktree branch prefix and deletion are
 * all editable. The only exception is Tower's machine marker (`isBuiltin`),
 * which is filtered out entirely — users have no reason to know it exists, and
 * the server actions refuse to touch it regardless.
 *
 * Which group a new label lands in is decided by which group's Add row was used,
 * so no level dropdown is needed.
 */
export function LabelsSection() {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [defaultPrefix, setDefaultPrefix] = useState(DEFAULT_BRANCH_PREFIX);

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

  // Tower's own marker is a machine detail, not a label anyone manages here.
  const visible = labels.filter((l) => !l.isBuiltin);
  const systemLabels = visible.filter((l) => l.workspaceId === null);
  const workspaceLabels = visible.filter((l) => l.workspaceId !== null);

  const handleAdd = async (name: string, color: string, scope: string | null) => {
    try {
      await createLabel({ name, color, workspaceId: scope });
    } catch {
      toast.error(t("settings.config.labels.saveFailed"));
      return;
    }
    await reload();
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteLabel(id);
    } catch {
      toast.error(t("settings.config.labels.saveFailed"));
      await reload();
      return;
    }
    setLabels((prev) => prev.filter((l) => l.id !== id));
  };

  const patch = (id: string, fields: Partial<LabelItem>) =>
    setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, ...fields } : l)));

  const handleNameBlur = async (label: LabelItem) => {
    const name = label.name.trim();
    if (!name || name.length > MAX_LABEL_NAME) {
      toast.error(t("settings.config.labels.invalidName"));
      return; // reject the save, keep the text so the user can fix it
    }
    try {
      await updateLabel(label.id, { name });
    } catch {
      toast.error(t("settings.config.labels.saveFailed"));
      await reload();
    }
  };

  const handlePrefixBlur = async (label: LabelItem) => {
    const prefix = label.branchPrefix?.trim() ?? "";
    if (prefix && !isValidBranchPrefix(prefix)) {
      toast.error(t("settings.config.labels.invalidPrefix"));
      return; // reject the save, keep the text so the user can fix it
    }
    try {
      await updateLabel(label.id, { branchPrefix: prefix || null });
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

  // Both groups render the same row: the level is carried by the group heading,
  // not by a per-row badge.
  const labelRow = (label: LabelItem) => (
    <li key={label.id} className="flex items-center gap-3 px-5 py-3">
      <span
        className="size-3 shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      <Input
        value={label.name}
        onChange={(e) => patch(label.id, { name: e.target.value })}
        onBlur={() => void handleNameBlur(label)}
        maxLength={MAX_LABEL_NAME}
        aria-label={t("settings.config.labels.namePlaceholder")}
        className="w-40 shrink-0 text-sm"
      />
      <Input
        value={label.branchPrefix ?? ""}
        onChange={(e) => patch(label.id, { branchPrefix: e.target.value })}
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
        size="icon"
        onClick={() => void handleDelete(label.id)}
        className="shrink-0 text-destructive"
        title={t("settings.config.labels.delete")}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );

  return (
    <div id="labels" className="scroll-mt-4">
      <div className="mb-4 min-w-0">
        <h3 className="text-sm font-semibold">{t("settings.config.labels.title")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("settings.config.labels.desc")}
        </p>
      </div>

      {/* System labels — every workspace can use these */}
      <div className="mb-1.5 flex min-h-8 items-center gap-2">
        <h4 className="text-xs font-semibold">{t("settings.config.labels.groupSystem")}</h4>
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {t("settings.config.labels.groupSystemHint")}
        </p>
      </div>
      <ul className="divide-y rounded-xl border border-border bg-card">
        {systemLabels.map(labelRow)}
        <AddLabelRow
          addLabel={t("settings.config.labels.addSystem")}
          onAdd={(name, color) => handleAdd(name, color, null)}
        />
      </ul>

      {/* Workspace labels — scoped to the workspace picked on this very row */}
      <div className="mt-4 mb-1.5 flex min-h-8 items-center justify-between gap-4">
        <h4 className="text-xs font-semibold">{t("settings.config.labels.groupWorkspace")}</h4>
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
        {workspaceLabels.map(labelRow)}
        <AddLabelRow
          addLabel={t("settings.config.labels.addWorkspace")}
          onAdd={(name, color) => handleAdd(name, color, workspaceId)}
          disabled={!workspaceId}
        />
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
