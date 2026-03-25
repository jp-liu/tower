"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Settings, Archive, Plus, Pencil, Trash2, Check, X,
  MoreHorizontal, Layers, ChevronsLeft, ChevronsRight,
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

const TABS = [
  { id: "all", label: "\u5168\u90e8" },
  { id: "requirement", label: "\u9700\u6c42" },
  { id: "bug", label: "\u7f3a\u9677" },
  { id: "task", label: "\u4efb\u52a1" },
];

const WORKSPACE_ICONS = ["\u{1f4cb}", "\u{1f680}", "\u{1f3af}", "\u{1f4a1}", "\u{1f527}", "\u{1f4e6}", "\u{1f3a8}", "\u{1f4ca}", "\u{1f52c}", "\u{1f31f}", "\u{1f4dd}", "\u{1f3d7}\ufe0f"];

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
  const [activeTab, setActiveTab] = useState("all");
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sidebar-collapsed") === "true";
    }
    return false;
  });
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("\u{1f4cb}");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  const activeWorkspaceId = pathname.split("/workspaces/")[1]?.split("/")[0];

  useEffect(() => {
    if (editingId && editRef.current) editRef.current.focus();
  }, [editingId]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    const ws = await createWorkspace({ name: newName.trim(), description: newIcon });
    setNewName("");
    setNewIcon("\u{1f4cb}");
    setShowCreateDialog(false);
    router.refresh();
    router.push(`/workspaces/${ws.id}`);
  }, [newName, newIcon, router]);

  const handleRename = useCallback(async (id: string) => {
    if (!editName.trim()) { setEditingId(null); return; }
    await updateWorkspace(id, { name: editName.trim() });
    setEditingId(null);
    router.refresh();
  }, [editName, router]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`\u786e\u8ba4\u5220\u9664\u5de5\u4f5c\u7a7a\u95f4\u300c${name}\u300d\uff1f\u6240\u6709\u9879\u76ee\u548c\u4efb\u52a1\u5c06\u88ab\u5220\u9664\u3002`)) return;
    await deleteWorkspace(id);
    router.refresh();
    if (activeWorkspaceId === id) router.push("/workspaces");
  }, [activeWorkspaceId, router]);

  const getIcon = (ws: WorkspaceItem) => {
    if (ws.description && WORKSPACE_ICONS.includes(ws.description)) return ws.description;
    return ws.name.charAt(0).toUpperCase();
  };

  // Collapsed view
  if (collapsed) {
    return (
      <aside className="flex h-screen w-14 flex-col items-center border-r border-border bg-sidebar py-3">
        {/* Logo */}
        <button
          onClick={toggleCollapsed}
          className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/25 transition-transform hover:scale-105"
          title="\u5c55\u5f00\u4fa7\u8fb9\u680f"
        >
          <Layers className="h-4 w-4 text-amber-400" />
        </button>

        {/* Workspace icons */}
        <div className="flex flex-1 flex-col items-center gap-1.5 overflow-auto">
          {workspaces.map((ws) => {
            const isActive = activeWorkspaceId === ws.id;
            const icon = getIcon(ws);
            return (
              <button
                key={ws.id}
                onClick={() => router.push(`/workspaces/${ws.id}`)}
                title={ws.name}
                className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm transition-all ${
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
            title="\u65b0\u5efa\u5de5\u4f5c\u7a7a\u95f4"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Settings */}
        <button
          onClick={() => router.push("/settings")}
          className="mt-2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </button>

        {/* Create dialog (shared) */}
        <CreateWorkspaceDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          name={newName}
          onNameChange={setNewName}
          icon={newIcon}
          onIconChange={setNewIcon}
          onCreate={handleCreate}
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
          title="\u6298\u53e0\u4fa7\u8fb9\u680f"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Workspace Header */}
      <div className="relative z-10 flex items-center justify-between px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">\u5de5\u4f5c\u7a7a\u95f4</span>
        <div className="flex items-center gap-0.5">
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setShowCreateDialog(true)}
            title="\u65b0\u5efa\u5de5\u4f5c\u7a7a\u95f4"
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

      {/* Tab Filters */}
      <div className="relative z-10 flex gap-1 px-3 py-1.5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
              activeTab === tab.id
                ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Workspace List */}
      <div className="relative z-10 mt-2 flex-1 overflow-auto px-2">
        {workspaces.map((ws) => {
          const isActive = activeWorkspaceId === ws.id;
          const isEditing = editingId === ws.id;
          const icon = getIcon(ws);

          if (isEditing) {
            return (
              <div key={ws.id} className="flex items-center gap-1 rounded-lg bg-accent px-3 py-2 ring-1 ring-border">
                <input
                  ref={editRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(ws.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="flex-1 bg-transparent text-sm text-foreground outline-none"
                />
                <button onClick={() => handleRename(ws.id)} className="rounded p-0.5 text-amber-400 hover:text-amber-300">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setEditingId(null)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }

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
                  <DropdownMenuItem onClick={() => { setEditingId(ws.id); setEditName(ws.name); }}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    \u91cd\u547d\u540d
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-rose-400" onClick={() => handleDelete(ws.id, ws.name)}>
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    \u5220\u9664
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
        <span>\u5f52\u6863</span>
        <span className="ml-auto font-mono">0</span>
      </div>

      {/* Create Workspace Dialog */}
      <CreateWorkspaceDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        name={newName}
        onNameChange={setNewName}
        icon={newIcon}
        onIconChange={setNewIcon}
        onCreate={handleCreate}
      />
    </aside>
  );
}

// Create Workspace Dialog
function CreateWorkspaceDialog({
  open, onOpenChange, name, onNameChange, icon, onIconChange, onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  icon: string;
  onIconChange: (icon: string) => void;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{"\u65b0\u5efa\u5de5\u4f5c\u7a7a\u95f4"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{"\u540d\u79f0"}</label>
            <Input
              placeholder={"\u8f93\u5165\u5de5\u4f5c\u7a7a\u95f4\u540d\u79f0"}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onCreate()}
              className="mt-1.5"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{"\u56fe\u6807"}</label>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>{"\u53d6\u6d88"}</Button>
          <Button
            onClick={onCreate}
            disabled={!name.trim()}
            className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
          >
            {"\u521b\u5efa"}
          </Button>
        </DialogFooter>
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
