"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Settings, Plus, Command } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { searchTasks } from "@/actions/task-actions";

const TOP_I18N = JSON.parse('{"newProject":"新建项目","projectName":"项目名称","projectAlias":"项目别名","projectDesc":"项目描述","normalProject":"普通项目","gitProject":"Git 项目","gitUrl":"Git 仓库地址","cancel":"取消","create":"创建","namePlaceholder":"输入项目名称","aliasPlaceholder":"可选，如：前端重构","descPlaceholder":"可选，项目简介","gitPlaceholder":"https://github.com/...","searchResults":"搜索结果"}');

interface SearchResult {
  id: string;
  title: string;
  projectId: string;
  project: {
    name: string;
    workspaceId: string;
    workspace: { name: string };
  };
}

interface CreateProjectData {
  name: string;
  alias?: string;
  description?: string;
  type: "NORMAL" | "GIT";
  gitUrl?: string;
}

interface TopBarProps {
  onCreateProject?: (data: CreateProjectData) => void;
}

export function TopBar({ onCreateProject }: TopBarProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectAlias, setProjectAlias] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [projectType, setProjectType] = useState<"NORMAL" | "GIT">("NORMAL");
  const [gitUrl, setGitUrl] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQuery.trim()) { setSearchResults([]); setShowResults(false); return; }
    searchTimerRef.current = setTimeout(async () => {
      const results = await searchTasks(searchQuery);
      setSearchResults(results as SearchResult[]);
      setShowResults(true);
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const resetForm = () => {
    setProjectName("");
    setProjectAlias("");
    setProjectDesc("");
    setProjectType("NORMAL");
    setGitUrl("");
  };

  const handleCreateProject = () => {
    if (projectName.trim()) {
      onCreateProject?.({
        name: projectName.trim(),
        alias: projectAlias.trim() || undefined,
        description: projectDesc.trim() || undefined,
        type: projectType,
        gitUrl: projectType === "GIT" && gitUrl.trim() ? gitUrl.trim() : undefined,
      });
      resetForm();
      setShowNewProject(false);
    }
  };

  return (
    <>
      <header className="flex h-12 items-center justify-between border-b border-border bg-background/80 px-5 backdrop-blur-sm">
        <div className="w-40" />

        {/* Search */}
        <div ref={searchContainerRef} className="relative w-96">
          <div className="relative flex items-center">
            <Search className="absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
            <input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setShowResults(true); }}
              className="h-8 w-full rounded-lg border border-border bg-muted/50 pl-9 pr-12 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-amber-500/40 focus:bg-muted focus:ring-1 focus:ring-amber-500/20"
            />
            <kbd className="absolute right-3 flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
          </div>

          {showResults && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-xl border border-border bg-card shadow-2xl shadow-black/20 max-h-80 overflow-auto">
              <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {TOP_I18N.searchResults}
              </div>
              {searchResults.map((task) => (
                <button
                  key={task.id}
                  onClick={() => {
                    router.push(`/workspaces/${task.project.workspaceId}?projectId=${task.projectId}`);
                    setSearchQuery("");
                    setShowResults(false);
                  }}
                  className="flex w-full flex-col px-3 py-2.5 text-left transition-colors hover:bg-accent border-t border-border/50 first:border-t-0"
                >
                  <span className="text-sm font-medium text-foreground">{task.title}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {task.project.workspace.name} → {task.project.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25 hover:text-amber-200"
            onClick={() => setShowNewProject(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {TOP_I18N.newProject}
          </Button>
          <div className="ml-1 flex items-center gap-2">
            <Avatar className="h-7 w-7 ring-1 ring-border">
              <AvatarFallback className="bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
                JP
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      <Dialog open={showNewProject} onOpenChange={(open) => { setShowNewProject(open); if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{TOP_I18N.newProject}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Name */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{TOP_I18N.projectName}</label>
              <Input
                placeholder={TOP_I18N.namePlaceholder}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="mt-1.5"
              />
            </div>

            {/* Alias */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{TOP_I18N.projectAlias}</label>
              <Input
                placeholder={TOP_I18N.aliasPlaceholder}
                value={projectAlias}
                onChange={(e) => setProjectAlias(e.target.value)}
                className="mt-1.5"
              />
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{TOP_I18N.projectDesc}</label>
              <textarea
                placeholder={TOP_I18N.descPlaceholder}
                value={projectDesc}
                onChange={(e) => setProjectDesc(e.target.value)}
                rows={3}
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 resize-none"
              />
            </div>

            {/* Type toggle */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {TOP_I18N.projectName.replace(TOP_I18N.projectName, "")}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setProjectType("NORMAL")}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    projectType === "NORMAL"
                      ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {TOP_I18N.normalProject}
                </button>
                <button
                  type="button"
                  onClick={() => setProjectType("GIT")}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    projectType === "GIT"
                      ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {TOP_I18N.gitProject}
                </button>
              </div>
            </div>

            {/* Git URL (conditional) */}
            {projectType === "GIT" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">{TOP_I18N.gitUrl}</label>
                <Input
                  placeholder={TOP_I18N.gitPlaceholder}
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  className="mt-1.5"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowNewProject(false); resetForm(); }}>
              {TOP_I18N.cancel}
            </Button>
            <Button
              onClick={handleCreateProject}
              disabled={!projectName.trim()}
              className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
            >
              {TOP_I18N.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
