"use client";

import { useState } from "react";
import { Settings, Archive } from "lucide-react";

const TABS = [
  { id: "all", label: "全部" },
  { id: "requirement", label: "需求" },
  { id: "bug", label: "缺陷" },
  { id: "task", label: "任务" },
];

interface WorkspaceItem {
  id: string;
  name: string;
  updatedAt: string;
}

const mockWorkspaces: WorkspaceItem[] = [
  { id: "1", name: "测试", updatedAt: "1h ago" },
];

export function AppSidebar() {
  const [activeTab, setActiveTab] = useState("all");
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>("1");

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
        <button className="rounded p-1 hover:bg-white/10">
          <Settings className="h-4 w-4" />
        </button>
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

      {/* Workspace List */}
      <div className="mt-2 flex-1 overflow-auto px-2">
        {mockWorkspaces.map((ws) => (
          <button
            key={ws.id}
            onClick={() => setSelectedWorkspace(ws.id)}
            className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
              selectedWorkspace === ws.id
                ? "bg-white/15"
                : "hover:bg-white/10"
            }`}
          >
            <div className="text-sm font-medium">{ws.name}</div>
            <div className="text-xs text-white/50">{ws.updatedAt}</div>
          </button>
        ))}
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
