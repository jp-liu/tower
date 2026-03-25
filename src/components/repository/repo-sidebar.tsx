"use client";

import { ChevronDown, Search, FolderPlus } from "lucide-react";

interface RepoSidebarProps {
  projectName?: string;
}

const recentRepos = [
  { name: "paperclip", icon: "\uD83D\uDCE6" },
  { name: "auto4s", icon: "\uD83D\uDCE6" },
  { name: "KiroProxy", icon: "\uD83D\uDCE6" },
  { name: "inkos", icon: "\uD83D\uDCE6" },
  { name: "huobao-drama", icon: "\uD83D\uDCE6" },
];

export function RepoSidebar({ projectName = "Test" }: RepoSidebarProps) {
  return (
    <aside className="w-72 flex-shrink-0 border-l bg-white">
      {/* Project Selector */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-500">项目</span>
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </div>
        <div className="mt-1">
          <span className="text-sm">{projectName}</span>
        </div>
      </div>

      {/* Repository Info */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-500">仓库</span>
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </div>
      </div>

      {/* Add Repository */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-500">添加仓库</span>
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </div>

        <div className="mt-3">
          <p className="text-xs text-gray-400 mb-2">最近</p>
          <div className="space-y-1">
            {recentRepos.map((repo) => (
              <button
                key={repo.name}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <span className="text-xs">{repo.icon}</span>
                {repo.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-1">
          <p className="text-xs text-gray-400 mb-2">其他</p>
          <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            <Search className="h-3.5 w-3.5" />
            浏览磁盘上的仓库
          </button>
          <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            <FolderPlus className="h-3.5 w-3.5" />
            在磁盘上创建新仓库
          </button>
        </div>
      </div>
    </aside>
  );
}
