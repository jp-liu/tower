"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Search, FolderPlus, Package, GitBranch } from "lucide-react";

interface RepoSidebarProps {
  projectName?: string;
}

const recentRepos = [
  { name: "paperclip" },
  { name: "auto4s" },
  { name: "KiroProxy" },
  { name: "inkos" },
  { name: "huobao-drama" },
];

export function RepoSidebar({ projectName = "Test" }: RepoSidebarProps) {
  const [repoExpanded, setRepoExpanded] = useState(true);
  const [addRepoExpanded, setAddRepoExpanded] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  return (
    <aside className="relative w-72 flex-shrink-0 border-l border-border bg-[oklch(0.11_0.008_260)]">
      {/* Toast */}
      {toast && (
        <div className="absolute left-3 right-3 top-3 z-10 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 shadow-lg">
          {toast}
        </div>
      )}

      {/* Project Selector */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">项目</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="mt-1.5">
          <span className="text-sm font-medium text-foreground">{projectName}</span>
        </div>
      </div>

      {/* Repository Info */}
      <div className="border-b border-border p-4">
        <button
          onClick={() => setRepoExpanded(!repoExpanded)}
          className="flex w-full items-center justify-between"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">仓库</span>
          {repoExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        {repoExpanded && (
          <div className="mt-3 rounded-lg border border-border bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              <p className="text-xs">暂无已关联仓库</p>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground/60">点击下方添加仓库</p>
          </div>
        )}
      </div>

      {/* Add Repository */}
      <div className="p-4">
        <button
          onClick={() => setAddRepoExpanded(!addRepoExpanded)}
          className="flex w-full items-center justify-between"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">添加仓库</span>
          {addRepoExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        {addRepoExpanded && (
          <>
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">最近</p>
              <div className="space-y-0.5">
                {recentRepos.map((repo) => (
                  <button
                    key={repo.name}
                    onClick={() => showToast(`关联「${repo.name}」仓库功能开发中`)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-secondary-foreground transition-colors hover:bg-accent"
                  >
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    {repo.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">其他</p>
              <button
                onClick={() => showToast("浏览磁盘仓库功能开发中")}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Search className="h-3.5 w-3.5" />
                浏览磁盘上的仓库
              </button>
              <button
                onClick={() => showToast("创建仓库功能开发中")}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                在磁盘上创建新仓库
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
