"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Settings, Archive, Plus, Pencil, Trash2, Check, X, MoreHorizontal, Layers } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createWorkspace, updateWorkspace, deleteWorkspace } from "@/actions/workspace-actions";

const TABS = [
  { id: "all", label: "全部" },
  { id: "requirement", label: "需求" },
  { id: "bug", label: "缺陷" },
  { id: "task", label: "任务" },
];

interface WorkspaceItem {
  id: string;
  name: string;
  updatedAt: Date;
}

interface AppSidebarProps {
  workspaces: WorkspaceItem[];
}

export function AppSidebar({ workspaces }: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState("all");
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  const activeWorkspaceId = pathname.split("/workspaces/")[1]?.split("/")[0];

  useEffect(() => {
    if (isCreating && inputRef.current) inputRef.current.focus();
  }, [isCreating]);

  useEffect(() => {
    if (editingId && editRef.current) editRef.current.focus();
  }, [editingId]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) { setIsCreating(false); return; }
    const ws = await createWorkspace({ name: newName.trim() });
    setNewName("");
    setIsCreating(false);
    router.refresh();
    router.push(`/workspaces/${ws.id}`);
  }, [newName, router]);

  const handleRename = useCallback(async (id: string) => {
    if (!editName.trim()) { setEditingId(null); return; }
    await updateWorkspace(id, { name: editName.trim() });
    setEditingId(null);
    router.refresh();
  }, [editName, router]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`确认删除工作空间「${name}」？所有项目和任务将被删除。`)) return;
    await deleteWorkspace(id);
    router.refresh();
    if (activeWorkspaceId === id) {
      router.push("/workspaces");
    }
  }, [activeWorkspaceId, router]);

  return (
    <aside className="noise relative flex h-screen w-56 flex-col border-r border-border bg-sidebar">
      {/* Logo */}
      <div className="relative z-10 flex items-center gap-3 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/25">
          <Layers className="h-4.5 w-4.5 text-amber-400" />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-tight text-foreground">AI Manager</div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Studio</div>
        </div>
      </div>

      {/* Workspace Header */}
      <div className="relative z-10 flex items-center justify-between px-5 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">工作空间</span>
        <div className="flex items-center gap-0.5">
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setIsCreating(true)}
            title="新建工作空间"
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
      <div className="relative z-10 flex gap-1 px-4 py-1.5">
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

      {/* Create Workspace Input */}
      {isCreating && (
        <div className="relative z-10 mx-3 mt-2 flex items-center gap-1 rounded-lg bg-accent px-3 py-2 ring-1 ring-amber-500/20">
          <input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") { setIsCreating(false); setNewName(""); }
            }}
            placeholder="工作空间名称"
            className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
          />
          <button onClick={handleCreate} className="rounded p-0.5 text-amber-400 hover:text-amber-300">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => { setIsCreating(false); setNewName(""); }} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Workspace List */}
      <div className="relative z-10 mt-2 flex-1 overflow-auto px-3">
        {workspaces.map((ws) => {
          const isActive = activeWorkspaceId === ws.id;
          const isEditing = editingId === ws.id;

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
                isActive
                  ? "bg-accent ring-1 ring-amber-500/15"
                  : "hover:bg-accent/60"
              }`}
            >
              <button
                onClick={() => router.push(`/workspaces/${ws.id}`)}
                className="flex-1 px-3 py-2.5 text-left"
              >
                <div className={`text-sm font-medium ${isActive ? "text-foreground" : "text-secondary-foreground"}`}>
                  {ws.name}
                </div>
                <div className="text-[11px] text-muted-foreground">{formatTime(ws.updatedAt)}</div>
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
                    重命名
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-rose-400"
                    onClick={() => handleDelete(ws.id, ws.name)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="relative z-10 flex items-center gap-2 border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
        <Archive className="h-3.5 w-3.5" />
        <span>归档</span>
        <span className="ml-auto font-mono">0</span>
      </div>
    </aside>
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
