"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Search, FolderPlus, Package } from "lucide-react";

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
    <aside className="relative w-72 flex-shrink-0 border-l bg-white">
      {/* Toast */}
      {toast && (
        <div className="absolute left-4 right-4 top-4 z-10 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700 shadow-sm">
          {toast}
        </div>
      )}

      {/* Project Selector */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-500">项目</span>
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </div>
        <div className="mt-1">
          <span className="text-sm font-medium">{projectName}</span>
        </div>
      </div>

      {/* Repository Info */}
      <div className="border-b p-4">
        <button
          onClick={() => setRepoExpanded(!repoExpanded)}
          className="flex w-full items-center justify-between"
        >
          <span className="text-sm font-medium text-gray-500">仓库</span>
          {repoExpanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </button>
        {repoExpanded && (
          <div className="mt-3 rounded-lg border bg-gray-50 p-3">
            <p className="text-xs text-gray-400">暂无已关联仓库</p>
            <p className="mt-1 text-xs text-gray-400">点击下方添加仓库</p>
          </div>
        )}
      </div>

      {/* Add Repository */}
      <div className="p-4">
        <button
          onClick={() => setAddRepoExpanded(!addRepoExpanded)}
          className="flex w-full items-center justify-between"
        >
          <span className="text-sm font-medium text-gray-500">添加仓库</span>
          {addRepoExpanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </button>

        {addRepoExpanded && (
          <>
            <div className="mt-3">
              <p className="text-xs text-gray-400 mb-2">最近</p>
              <div className="space-y-0.5">
                {recentRepos.map((repo) => (
                  <button
                    key={repo.name}
                    onClick={() => showToast(`关联「${repo.name}」仓库功能开发中`)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Package className="h-3.5 w-3.5 text-gray-400" />
                    {repo.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-0.5">
              <p className="text-xs text-gray-400 mb-2">其他</p>
              <button
                onClick={() => showToast("浏览磁盘仓库功能开发中")}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                <Search className="h-3.5 w-3.5" />
                浏览磁盘上的仓库
              </button>
              <button
                onClick={() => showToast("创建仓库功能开发中")}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
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
