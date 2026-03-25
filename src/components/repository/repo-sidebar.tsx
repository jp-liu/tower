"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Search, FolderPlus, Package, GitBranch, Globe, FileText } from "lucide-react";

const SIDEBAR_I18N = JSON.parse('{"projectInfo":"项目信息","alias":"别名","description":"描述","type":"类型","normalType":"普通项目","gitType":"Git 项目","gitUrl":"仓库地址","repo":"仓库","addRepo":"添加仓库","noRepo":"暂无已关联仓库","addRepoHint":"点击下方添加仓库","recent":"最近","other":"其他","browseRepo":"浏览磁盘上的仓库","createRepo":"在磁盘上创建新仓库","browseWip":"浏览磁盘仓库功能开发中","createWip":"创建仓库功能开发中","linkWip":"关联仓库功能开发中"}');

interface ProjectSidebarProps {
  project: {
    id: string;
    name: string;
    alias: string | null;
    description: string | null;
    type: string;
    gitUrl: string | null;
  };
}

const recentRepos = [
  { name: "paperclip" },
  { name: "auto4s" },
  { name: "KiroProxy" },
  { name: "inkos" },
  { name: "huobao-drama" },
];

export function RepoSidebar({ project }: ProjectSidebarProps) {
  const [repoExpanded, setRepoExpanded] = useState(true);
  const [addRepoExpanded, setAddRepoExpanded] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  return (
    <aside className="relative w-72 flex-shrink-0 border-l border-border bg-sidebar">
      {/* Toast */}
      {toast && (
        <div className="absolute left-3 right-3 top-3 z-10 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 shadow-lg">
          {toast}
        </div>
      )}

      {/* Project Details (always visible) */}
      <div className="border-b border-border p-4">
        <h2 className="text-base font-semibold text-foreground">{project.name}</h2>
        {project.alias && (
          <p className="mt-0.5 text-xs text-muted-foreground">{project.alias}</p>
        )}
        {project.description && (
          <p className="mt-2 text-sm text-secondary-foreground leading-relaxed">{project.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
            project.type === "GIT"
              ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/20"
              : "bg-muted text-muted-foreground ring-1 ring-border"
          }`}>
            {project.type === "GIT" ? (
              <><GitBranch className="h-3 w-3" />{SIDEBAR_I18N.gitType}</>
            ) : (
              <><FileText className="h-3 w-3" />{SIDEBAR_I18N.normalType}</>
            )}
          </span>
        </div>
        {project.gitUrl && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs">
            <Globe className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="break-all text-secondary-foreground">{project.gitUrl}</span>
          </div>
        )}
      </div>

      {/* Repository Info */}
      <div className="border-b border-border p-4">
        <button
          onClick={() => setRepoExpanded(!repoExpanded)}
          className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-2 transition-colors hover:bg-accent"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{SIDEBAR_I18N.repo}</span>
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
              <p className="text-xs">{SIDEBAR_I18N.noRepo}</p>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{SIDEBAR_I18N.addRepoHint}</p>
          </div>
        )}
      </div>

      {/* Add Repository */}
      <div className="p-4">
        <button
          onClick={() => setAddRepoExpanded(!addRepoExpanded)}
          className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-2 transition-colors hover:bg-accent"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{SIDEBAR_I18N.addRepo}</span>
          {addRepoExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        {addRepoExpanded && (
          <>
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{SIDEBAR_I18N.recent}</p>
              <div className="space-y-0.5">
                {recentRepos.map((repo) => (
                  <button
                    key={repo.name}
                    onClick={() => showToast(`${SIDEBAR_I18N.linkWip}`)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-secondary-foreground transition-colors hover:bg-accent"
                  >
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    {repo.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{SIDEBAR_I18N.other}</p>
              <button
                onClick={() => showToast(SIDEBAR_I18N.browseWip)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Search className="h-3.5 w-3.5" />
                {SIDEBAR_I18N.browseRepo}
              </button>
              <button
                onClick={() => showToast(SIDEBAR_I18N.createWip)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {SIDEBAR_I18N.createRepo}
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
