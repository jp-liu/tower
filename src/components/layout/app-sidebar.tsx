"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Settings, Archive, Plus, Pencil, Trash2, Check, X } from "lucide-react";
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
    <aside className="flex h-screen w-52 flex-col bg-gradient-to-b from-violet-600 to-purple-700 text-white">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-sm font-bold">
          AI
        </div>
        <div>
          <div className="text-sm font-semibold">AI Manager</div>
          <div className="text-xs text-white/60">项目管理平台</div>
        </div>
      </div>

      {/* Workspace Header */}
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-sm font-medium">工作空间</span>
        <div className="flex items-center gap-1">
          <button
            className="rounded p-1 hover:bg-white/10"
            onClick={() => setIsCreating(true)}
            title="新建工作空间"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            className="rounded p-1 hover:bg-white/10"
            onClick={() => router.push("/settings")}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tab Filters */}
      <div className="flex gap-1 px-3 py-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
              activeTab === tab.id
                ? "bg-white text-purple-700 font-medium"
                : "text-white/80 hover:bg-white/10"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Create Workspace Input */}
      {isCreating && (
        <div className="mx-2 mt-2 flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1.5">
          <input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") { setIsCreating(false); setNewName(""); }
            }}
            placeholder="工作空间名称"
            className="flex-1 bg-transparent text-sm placeholder-white/40 outline-none"
          />
          <button onClick={handleCreate} className="rounded p-0.5 hover:bg-white/10">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => { setIsCreating(false); setNewName(""); }} className="rounded p-0.5 hover:bg-white/10">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Workspace List */}
      <div className="mt-2 flex-1 overflow-auto px-2">
        {workspaces.map((ws) => {
          const isActive = activeWorkspaceId === ws.id;
          const isEditing = editingId === ws.id;

          if (isEditing) {
            return (
              <div key={ws.id} className="flex items-center gap-1 rounded-lg bg-white/15 px-3 py-2">
                <input
                  ref={editRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(ws.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="flex-1 bg-transparent text-sm outline-none"
                />
                <button onClick={() => handleRename(ws.id)} className="rounded p-0.5 hover:bg-white/10">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setEditingId(null)} className="rounded p-0.5 hover:bg-white/10">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }

          return (
            <DropdownMenu key={ws.id}>
              <DropdownMenuTrigger
                render={
                  <button
                    onClick={() => router.push(`/workspaces/${ws.id}`)}
                    className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                      isActive ? "bg-white/15" : "hover:bg-white/10"
                    }`}
                  />
                }
              >
                <div className="text-sm font-medium">{ws.name}</div>
                <div className="text-xs text-white/50">{formatTime(ws.updatedAt)}</div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right">
                <DropdownMenuItem onClick={() => { setEditingId(ws.id); setEditName(ws.name); }}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-red-600"
                  onClick={() => handleDelete(ws.id, ws.name)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3 text-xs text-white/60">
        <Archive className="h-3.5 w-3.5" />
        <span>查看归档</span>
        <span className="ml-auto">0</span>
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
