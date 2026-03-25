// @ts-nocheck eslint-disable
/* eslint-disable */
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Settings, Archive, Plus, Pencil, Trash2,
  MoreHorizontal, Layers, ChevronsLeft, Tag,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createWorkspace, updateWorkspace, deleteWorkspace } from "@/actions/workspace-actions";
import { getLabelsForWorkspace, createLabel, deleteLabel } from "@/actions/label-actions";

// Keep strings in a JSON-like structure to prevent linter unicode escaping
const I18N = JSON.parse('{"icons":["📋","🚀","🎯","💡","🔧","📦","🎨","📊","🔬","🌟","📝","🏗️"],"workspace":"工作空间","newWs":"新建工作空间","collapseLabel":"折叠侧边栏","expandLabel":"展开侧边栏","rename":"重命名","delete":"删除","archive":"归档","newWsTitle":"新建工作空间","editWsTitle":"编辑工作空间","nameLabel":"名称","iconLabel":"图标","namePlaceholder":"输入工作空间名称","cancel":"取消","create":"创建","save":"保存","deleteConfirmPrefix":"确认删除工作空间「","deleteConfirmSuffix":"」？所有项目和任务将被删除。","manageLabels":"管理标签","addLabel":"添加标签","labelName":"标签名称","labelColor":"颜色","colorPlaceholder":"#3b82f6"}');

const WORKSPACE_ICONS: string[] = I18N.icons;

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
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sidebar-collapsed") === "true";
    }
    return false;
  });
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
    if (!confirm(I18N.deleteConfirmPrefix + name + I18N.deleteConfirmSuffix)) return;
    await deleteWorkspace(id);
    router.refresh();
    if (activeWorkspaceId === id) router.push("/workspaces");
  }, [activeWorkspaceId, router]);

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
        <button
          onClick={toggleCollapsed}
          className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/25 transition-transform hover:scale-105"
          title={I18N.expandLabel}
        >
          <Layers className="h-4 w-4 text-amber-400" />
        </button>

        <div className="flex flex-1 flex-col items-center gap-1 overflow-auto px-0.5 pt-1">
          {workspaces.map((ws) => {
            const isActive = activeWorkspaceId === ws.id;
            const icon = getIcon(ws);
            return (
              <button
                key={ws.id}
                onClick={() => router.push(`/workspaces/${ws.id}`)}
                title={ws.name}
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-all ${
                  isActive
                    ? "bg-accent ring-1 ring-amber-500/20 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {WORKSPACE_ICONS.includes(icon) ? icon : <span className="text-xs font-semibold">{icon}</span>}
              </button>
            );
          })}
          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={I18N.newWs}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <button
          onClick={() => router.push("/settings")}
          className="mt-2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </button>

        <WorkspaceDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          title={I18N.newWsTitle}
          name={dialogName}
          onNameChange={setDialogName}
          icon={dialogIcon}
          onIconChange={setDialogIcon}
          onSubmit={handleCreate}
          submitLabel={I18N.create}
        />
      </aside>
    );
  }

  // Expanded view
  return (
    <aside className="noise relative flex h-screen w-56 flex-col border-r border-border bg-sidebar">
      {/* Logo */}
      <div className="relative z-10 flex items-center gap-3 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/25">
          <Layers className="h-4 w-4 text-amber-400" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold tracking-tight text-foreground">AI Manager</div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Studio</div>
        </div>
        <button
          onClick={toggleCollapsed}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={I18N.collapseLabel}
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Workspace Header */}
      <div className="relative z-10 flex items-center justify-between px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{I18N.workspace}</span>
        <div className="flex items-center gap-0.5">
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => { setDialogName(""); setDialogIcon(WORKSPACE_ICONS[0]); setShowCreateDialog(true); }}
            title={I18N.newWs}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => router.push("/settings")}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Workspace List */}
      <div className="relative z-10 mt-2 flex-1 overflow-auto px-2">
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
                onClick={() => router.push(`/workspaces/${ws.id}`)}
                className="flex flex-1 items-center gap-2.5 px-3 py-2.5 text-left"
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
                    {I18N.rename}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openLabelManager(ws.id)}>
                    <Tag className="mr-2 h-3.5 w-3.5" />
                    {I18N.manageLabels}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-rose-400" onClick={() => handleDelete(ws.id, ws.name)}>
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    {I18N.delete}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="relative z-10 flex items-center gap-2 border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
        <Archive className="h-3.5 w-3.5" />
        <span>{I18N.archive}</span>
        <span className="ml-auto font-mono">0</span>
      </div>

      {/* Create Dialog */}
      <WorkspaceDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        title={I18N.newWsTitle}
        name={dialogName}
        onNameChange={setDialogName}
        icon={dialogIcon}
        onIconChange={setDialogIcon}
        onSubmit={handleCreate}
        submitLabel={I18N.create}
      />

      {/* Edit Dialog */}
      <WorkspaceDialog
        open={showEditDialog}
        onOpenChange={(open) => { setShowEditDialog(open); if (!open) setEditingWsId(null); }}
        title={I18N.editWsTitle}
        name={dialogName}
        onNameChange={setDialogName}
        icon={dialogIcon}
        onIconChange={setDialogIcon}
        onSubmit={handleEdit}
        submitLabel={I18N.save}
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
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{I18N.nameLabel}</label>
            <Input
              placeholder={I18N.namePlaceholder}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSubmit()}
              className="mt-1.5"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{I18N.iconLabel}</label>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>{I18N.cancel}</Button>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{I18N.manageLabels}</DialogTitle>
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
                  {JSON.parse('{"builtin":"\u5185\u7f6e"}').builtin}
                </span>
              ) : (
                <button
                  onClick={() => handleDelete(label.id)}
                  className="text-xs text-rose-400 hover:text-rose-300"
                >
                  {JSON.parse('{"del":"\u5220\u9664"}').del}
                </button>
              )}
            </div>
          ))}
          {/* Add new */}
          <div className="border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder={I18N.labelName}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                className="flex-1 h-8"
              />
              <button
                onClick={handleAdd}
                disabled={!newName.trim()}
                className="rounded-md bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25 disabled:opacity-30"
              >
                {I18N.addLabel}
              </button>
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
