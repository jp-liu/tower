"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Settings, Archive, Plus, Pencil, Trash2,
  MoreHorizontal, Layers, ChevronsLeft, Tag, FileText, FolderOpen, Gauge,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createWorkspace, updateWorkspace, deleteWorkspace } from "@/actions/workspace-actions";
import { getLabelsForWorkspace, createLabel, deleteLabel } from "@/actions/label-actions";
import { useI18n } from "@/lib/i18n";

const WORKSPACE_ICONS: string[] = ["\u{1F4CB}","\u{1F680}","\u{1F3AF}","\u{1F4A1}","\u{1F527}","\u{1F4E6}","\u{1F3A8}","\u{1F4CA}","\u{1F52C}","\u{1F31F}","\u{1F4DD}","\u{1F3D7}\uFE0F"];

interface WorkspaceItem {
  id: string;
  name: string;
  description: string | null;
  updatedAt: Date;
}

interface AppSidebarProps {
  workspaces: WorkspaceItem[];
}

export function AppSidebar({ workspaces }: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);

  // Read collapsed state from localStorage after hydration to avoid mismatch
  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showLabelManager, setShowLabelManager] = useState(false);
  const [labelManagerWsId, setLabelManagerWsId] = useState<string | null>(null);
  const [dialogName, setDialogName] = useState("");
  const [dialogIcon, setDialogIcon] = useState(WORKSPACE_ICONS[0]);
  const [editingWsId, setEditingWsId] = useState<string | null>(null);

  const activeWorkspaceId = pathname.split("/workspaces/")[1]?.split("/")[0];

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!dialogName.trim()) return;
    const ws = await createWorkspace({ name: dialogName.trim(), description: dialogIcon });
    setDialogName("");
    setDialogIcon(WORKSPACE_ICONS[0]);
    setShowCreateDialog(false);
    router.refresh();
    router.push(`/workspaces/${ws.id}`);
  }, [dialogName, dialogIcon, router]);

  const handleEdit = useCallback(async () => {
    if (!dialogName.trim() || !editingWsId) return;
    await updateWorkspace(editingWsId, { name: dialogName.trim(), description: dialogIcon });
    setDialogName("");
    setShowEditDialog(false);
    setEditingWsId(null);
    router.refresh();
  }, [dialogName, dialogIcon, editingWsId, router]);

  const openEditDialog = useCallback((ws: WorkspaceItem) => {
    setEditingWsId(ws.id);
    setDialogName(ws.name);
    setDialogIcon(ws.description && WORKSPACE_ICONS.includes(ws.description) ? ws.description : WORKSPACE_ICONS[0]);
    setShowEditDialog(true);
  }, []);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(t("sidebar.deleteConfirm", { name }))) return;
    await deleteWorkspace(id);
    router.refresh();
    if (activeWorkspaceId === id) router.push("/workspaces");
  }, [activeWorkspaceId, router, t]);

  const openLabelManager = useCallback((wsId: string) => {
    setLabelManagerWsId(wsId);
    setShowLabelManager(true);
  }, []);

  const getIcon = (ws: WorkspaceItem) => {
    if (ws.description && WORKSPACE_ICONS.includes(ws.description)) return ws.description;
    return ws.name.charAt(0).toUpperCase();
  };

  // Collapsed view
  if (collapsed) {
    return (
      <aside className="flex h-screen w-14 flex-col items-center border-r border-border bg-sidebar py-3">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={toggleCollapsed}
                className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/25 transition-transform hover:scale-105"
              />
            }
          >
            <Layers className="h-4 w-4 text-amber-400" />
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>{t("sidebar.expand")}</TooltipContent>
        </Tooltip>

        <ScrollArea className="flex-1 min-h-0"><div className="flex flex-col items-center gap-1 px-0.5 pt-1">
          {workspaces.map((ws) => {
            const isActive = activeWorkspaceId === ws.id;
            const icon = getIcon(ws);
            return (
              <Tooltip key={ws.id}>
                <TooltipTrigger
                  render={
                    <button
                      onClick={() => { if (!isActive) router.push(`/workspaces/${ws.id}`); }}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-all ${
                        isActive
                          ? "bg-accent ring-1 ring-primary/20 text-foreground cursor-default"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                      }`}
                    />
                  }
                >
                  {WORKSPACE_ICONS.includes(icon) ? icon : <span className="text-xs font-semibold">{icon}</span>}
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>{ws.name}</TooltipContent>
              </Tooltip>
            );
          })}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                />
              }
            >
              <Plus className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>{t("sidebar.newWorkspace")}</TooltipContent>
          </Tooltip>
        </div></ScrollArea>

        <div className="mt-2 flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() => router.push("/missions")}
                  className={`rounded-lg p-2 transition-colors ${
                    pathname === "/missions"
                      ? "text-foreground bg-accent"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                />
              }
            >
              <Gauge className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>{t("missions.navLabel")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() => router.push("/settings")}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                />
              }
            >
              <Settings className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>{t("sidebar.settings")}</TooltipContent>
          </Tooltip>
        </div>

        <WorkspaceDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          title={t("workspace.create")}
          name={dialogName}
          onNameChange={setDialogName}
          icon={dialogIcon}
          onIconChange={setDialogIcon}
          onSubmit={handleCreate}
          submitLabel={t("common.create")}
          nameLabel={t("workspace.name")}
          iconLabel={t("workspace.icon")}
          namePlaceholder={t("workspace.namePlaceholder")}
          cancelLabel={t("common.cancel")}
        />
      </aside>
    );
  }

  // Expanded view
  return (
    <aside className="noise relative flex h-screen w-56 flex-col border-r border-border bg-sidebar">
      {/* Logo */}
      <div className="relative z-10 flex items-center gap-3 px-4 py-4">
        <img src="/logo.png" alt="Tower" className="h-9 w-9 rounded-lg" />
        <div className="flex-1">
          <div className="text-sm font-semibold tracking-tight text-foreground">Tower</div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Studio</div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={toggleCollapsed}
          className="text-muted-foreground"
          title={t("sidebar.collapse")}
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* Workspace Header */}
      <div className="relative z-10 flex items-center justify-between px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("sidebar.workspace")}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          onClick={() => { setDialogName(""); setDialogIcon(WORKSPACE_ICONS[0]); setShowCreateDialog(true); }}
          title={t("sidebar.newWorkspace")}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Workspace List */}
      <ScrollArea className="relative z-10 mt-2 flex-1 min-h-0">
        <div className="px-2">
        {workspaces.map((ws) => {
          const isActive = activeWorkspaceId === ws.id;
          const icon = getIcon(ws);

          return (
            <div
              key={ws.id}
              className={`group relative flex items-center rounded-lg transition-all ${
                isActive ? "bg-accent ring-1 ring-amber-500/15" : "hover:bg-accent/60"
              }`}
            >
              <button
                onClick={() => { if (!isActive) router.push(`/workspaces/${ws.id}`); }}
                className={`flex flex-1 items-center gap-2.5 px-3 py-2.5 text-left ${isActive ? "cursor-default" : "cursor-pointer"}`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-sm">
                  {WORKSPACE_ICONS.includes(icon) ? icon : <span className="text-xs font-semibold text-muted-foreground">{icon}</span>}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={`truncate text-sm font-medium ${isActive ? "text-foreground" : "text-secondary-foreground"}`}>
                    {ws.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{formatTime(ws.updatedAt)}</div>
                </div>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      className="mr-2 rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-background hover:text-foreground group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    />
                  }
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right">
                  <DropdownMenuItem onClick={() => openEditDialog(ws)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    {t("sidebar.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openLabelManager(ws.id)}>
                    <Tag className="mr-2 h-3.5 w-3.5" />
                    {t("sidebar.manageLabels")}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-rose-400" onClick={() => handleDelete(ws.id, ws.name)}>
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    {t("sidebar.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
        </div>
      </ScrollArea>

      {/* Footer */}
      <Link
        href="/missions"
        className={`relative z-10 flex items-center gap-2 border-t border-border px-4 py-3 text-[11px] cursor-pointer transition-colors ${
          pathname === "/missions"
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Gauge className="h-3.5 w-3.5" />
        <span>{t("missions.navLabel")}</span>
      </Link>
      {(() => {
        const wsId = activeWorkspaceId || workspaces[0]?.id;
        if (!wsId) return null;
        return (
          <>
            <Link
              href={`/workspaces/${wsId}/notes`}
              className="relative z-10 flex items-center gap-2 border-t border-border px-4 py-3 text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>{t("sidebar.notes")}</span>
            </Link>
            <Link
              href={`/workspaces/${wsId}/assets`}
              className="relative z-10 flex items-center gap-2 px-4 py-3 text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>{t("sidebar.assets")}</span>
            </Link>
            <Link
              href={`/workspaces/${wsId}/archive`}
              className="relative z-10 flex items-center gap-2 px-4 py-3 text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
            >
              <Archive className="h-3.5 w-3.5" />
              <span>{t("sidebar.archive")}</span>
            </Link>
          </>
        );
      })()}

      {/* Create Dialog */}
      <WorkspaceDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        title={t("workspace.create")}
        name={dialogName}
        onNameChange={setDialogName}
        icon={dialogIcon}
        onIconChange={setDialogIcon}
        onSubmit={handleCreate}
        submitLabel={t("common.create")}
        nameLabel={t("workspace.name")}
        iconLabel={t("workspace.icon")}
        namePlaceholder={t("workspace.namePlaceholder")}
        cancelLabel={t("common.cancel")}
      />

      {/* Edit Dialog */}
      <WorkspaceDialog
        open={showEditDialog}
        onOpenChange={(open) => { setShowEditDialog(open); if (!open) setEditingWsId(null); }}
        title={t("workspace.edit")}
        name={dialogName}
        onNameChange={setDialogName}
        icon={dialogIcon}
        onIconChange={setDialogIcon}
        onSubmit={handleEdit}
        submitLabel={t("common.save")}
        nameLabel={t("workspace.name")}
        iconLabel={t("workspace.icon")}
        namePlaceholder={t("workspace.namePlaceholder")}
        cancelLabel={t("common.cancel")}
      />

      {/* Label Manager Dialog */}
      {labelManagerWsId && (
        <LabelManagerDialog
          open={showLabelManager}
          onOpenChange={(open) => { setShowLabelManager(open); if (!open) setLabelManagerWsId(null); }}
          workspaceId={labelManagerWsId}
        />
      )}
    </aside>
  );
}

// Reusable workspace create/edit dialog
function WorkspaceDialog({
  open, onOpenChange, title, name, onNameChange, icon, onIconChange, onSubmit, submitLabel,
  nameLabel, iconLabel, namePlaceholder, cancelLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  name: string;
  onNameChange: (name: string) => void;
  icon: string;
  onIconChange: (icon: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  nameLabel: string;
  iconLabel: string;
  namePlaceholder: string;
  cancelLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{nameLabel}</label>
            <Input
              placeholder={namePlaceholder}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              className="mt-1.5"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{iconLabel}</label>
            <div className="mt-1.5 grid grid-cols-6 gap-1.5">
              {WORKSPACE_ICONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => onIconChange(emoji)}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg transition-all ${
                    icon === emoji
                      ? "bg-amber-500/15 ring-2 ring-amber-500/30 scale-110"
                      : "bg-muted hover:bg-accent"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
          <Button
            onClick={onSubmit}
            disabled={!name.trim()}
            className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Label color presets
const LABEL_COLORS = ["#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

interface LabelItem {
  id: string;
  name: string;
  color: string;
  isBuiltin: boolean;
}

function LabelManagerDialog({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}) {
  const { t } = useI18n();
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(LABEL_COLORS[0]);

  useEffect(() => {
    if (open) {
      getLabelsForWorkspace(workspaceId).then(setLabels);
    }
  }, [open, workspaceId]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await createLabel({ name: newName.trim(), color: newColor, workspaceId });
    const updated = await getLabelsForWorkspace(workspaceId);
    setLabels(updated);
    setNewName("");
  };

  const handleDelete = async (id: string) => {
    await deleteLabel(id);
    setLabels((prev) => prev.filter((l) => l.id !== id));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("label.manage")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {/* Existing labels */}
          {labels.map((label) => (
            <div key={label.id} className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              <span className="flex-1 text-sm text-foreground">{label.name}</span>
              {label.isBuiltin ? (
                <span className="text-[10px] text-muted-foreground">
                  {t("label.builtin")}
                </span>
              ) : (
                <button
                  onClick={() => handleDelete(label.id)}
                  className="text-xs text-rose-400 hover:text-rose-300"
                >
                  {t("common.delete")}
                </button>
              )}
            </div>
          ))}
          {/* Add new */}
          <div className="border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder={t("label.name")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                className="flex-1 h-8"
              />
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!newName.trim()}
                className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
              >
                {t("label.add")}
              </Button>
            </div>
            {/* Color presets */}
            <div className="mt-2 flex gap-1.5">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={`h-5 w-5 rounded-full transition-all ${newColor === c ? "ring-2 ring-offset-2 ring-offset-background ring-foreground/30 scale-110" : ""}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatTime(date: Date): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
