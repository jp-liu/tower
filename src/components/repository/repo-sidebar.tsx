// @ts-nocheck
/* eslint-disable */
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Search, FolderPlus, Package, GitBranch, Globe, FileText, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProject } from "@/actions/workspace-actions";
import { useRouter } from "next/navigation";

const S = JSON.parse('{"projectInfo":"项目信息","alias":"别名","description":"描述","type":"类型","normalType":"普通项目","gitType":"Git 项目","gitUrl":"仓库地址","repo":"仓库","addRepo":"添加仓库","noRepo":"暂无已关联仓库","addRepoHint":"点击下方添加仓库","recent":"最近","other":"其他","browseRepo":"浏览磁盘上的仓库","createRepo":"在磁盘上创建新仓库","browseWip":"浏览磁盘仓库功能开发中","createWip":"创建仓库功能开发中","linkWip":"关联仓库功能开发中","edit":"编辑项目","name":"项目名称","aliasLabel":"别名","descLabel":"描述","save":"保存","cancel":"取消","namePlaceholder":"输入项目名称","aliasPlaceholder":"可选别名","descPlaceholder":"项目描述"}');

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
  const router = useRouter();
  const [repoExpanded, setRepoExpanded] = useState(true);
  const [addRepoExpanded, setAddRepoExpanded] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editAlias, setEditAlias] = useState(project.alias ?? "");
  const [editDesc, setEditDesc] = useState(project.description ?? "");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const handleSaveProject = async () => {
    await updateProject(project.id, {
      name: editName.trim(),
      description: editDesc.trim() || undefined,
    });
    router.refresh();
    setShowEditDialog(false);
  };

  const isGit = project.type === "GIT";

  return (
    <aside className="relative w-72 flex-shrink-0 border-l border-border bg-sidebar">
      {toast && (
        <div className="absolute left-3 right-3 top-3 z-10 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 shadow-lg">
          {toast}
        </div>
      )}

      {/* Project Details */}
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-foreground">{project.name}</h2>
            {project.alias && (
              <p className="mt-0.5 text-xs text-muted-foreground">{project.alias}</p>
            )}
          </div>
          <button
            onClick={() => {
              setEditName(project.name);
              setEditAlias(project.alias ?? "");
              setEditDesc(project.description ?? "");
              setShowEditDialog(true);
            }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={S.edit}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        {project.description && (
          <p className="mt-2 text-sm text-secondary-foreground leading-relaxed">{project.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
            isGit
              ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/20"
              : "bg-muted text-muted-foreground ring-1 ring-border"
          }`}>
            {isGit ? (
              <><GitBranch className="h-3 w-3" />{S.gitType}</>
            ) : (
              <><FileText className="h-3 w-3" />{S.normalType}</>
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

      {/* Git sections — only for Git projects */}
      {isGit && (
        <>
          {/* Repository Info */}
          <div className="border-b border-border p-4">
            <button
              onClick={() => setRepoExpanded(!repoExpanded)}
              className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-2 transition-colors hover:bg-accent"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{S.repo}</span>
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
                  <p className="text-xs">{S.noRepo}</p>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{S.addRepoHint}</p>
              </div>
            )}
          </div>

          {/* Add Repository */}
          <div className="p-4">
            <button
              onClick={() => setAddRepoExpanded(!addRepoExpanded)}
              className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-2 transition-colors hover:bg-accent"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{S.addRepo}</span>
              {addRepoExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
            {addRepoExpanded && (
              <>
                <div className="mt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{S.recent}</p>
                  <div className="space-y-0.5">
                    {recentRepos.map((repo) => (
                      <button
                        key={repo.name}
                        onClick={() => showToast(S.linkWip)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-secondary-foreground transition-colors hover:bg-accent"
                      >
                        <Package className="h-3.5 w-3.5 text-muted-foreground" />
                        {repo.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-4 space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{S.other}</p>
                  <button
                    onClick={() => showToast(S.browseWip)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Search className="h-3.5 w-3.5" />
                    {S.browseRepo}
                  </button>
                  <button
                    onClick={() => showToast(S.createWip)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    {S.createRepo}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Edit Project Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{S.edit}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{S.name}</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={S.namePlaceholder}
                className="mt-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{S.aliasLabel}</label>
              <Input
                value={editAlias}
                onChange={(e) => setEditAlias(e.target.value)}
                placeholder={S.aliasPlaceholder}
                className="mt-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{S.descLabel}</label>
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder={S.descPlaceholder}
                rows={3}
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>{S.cancel}</Button>
            <Button
              onClick={handleSaveProject}
              disabled={!editName.trim()}
              className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
            >
              {S.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
