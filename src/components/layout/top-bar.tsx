"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Search, Settings, Plus, Command, Globe, Sun, Moon } from "lucide-react";
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
import { SearchDialog } from "./search-dialog";
import { FolderBrowserDialog } from "./folder-browser-dialog";
import { useI18n } from "@/lib/i18n";

interface CreateProjectData {
  name: string;
  alias?: string;
  description?: string;
  type: "NORMAL" | "GIT";
  gitUrl?: string;
  localPath?: string;
}

interface TopBarProps {
  onCreateProject?: (data: CreateProjectData) => Promise<void> | void;
}

export function TopBar({ onCreateProject }: TopBarProps) {
  const { t, locale, setLocale } = useI18n();
  const [showSearch, setShowSearch] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectAlias, setProjectAlias] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [projectType, setProjectType] = useState<"NORMAL" | "GIT">("NORMAL");
  const [gitUrl, setGitUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  // Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const resetForm = () => {
    setProjectName("");
    setProjectAlias("");
    setProjectDesc("");
    setProjectType("NORMAL");
    setGitUrl("");
    setLocalPath("");
  };

  const handleCreateProject = async () => {
    if (projectName.trim()) {
      await onCreateProject?.({
        name: projectName.trim(),
        alias: projectAlias.trim() || undefined,
        description: projectDesc.trim() || undefined,
        type: projectType,
        gitUrl: projectType === "GIT" && gitUrl.trim() ? gitUrl.trim() : undefined,
        localPath: localPath.trim() || undefined,
      });
      resetForm();
      setShowNewProject(false);
    }
  };

  return (
    <>
      <header className="flex h-12 items-center justify-between border-b border-border bg-background/80 px-5 backdrop-blur-sm">
        <div className="w-40" />

        {/* Search button (opens dialog) */}
        <button
          onClick={() => setShowSearch(true)}
          className="flex h-8 w-96 items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">{t("topbar.searchPlaceholder")}</span>
          <kbd className="flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </button>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5">
          {/* Language Toggle */}
          <button
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={t("settings.language")}
          >
            <Globe className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold">{locale === "zh" ? "EN" : "中"}</span>
          </button>

          {/* Divider */}
          <div className="h-4 w-px bg-border" />

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
            {t("topbar.newProject")}
          </Button>
          <div className="ml-0.5">
            <Avatar className="h-7 w-7 ring-1 ring-border">
              <AvatarFallback className="bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
                JP
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      {/* Search Dialog */}
      <SearchDialog open={showSearch} onOpenChange={setShowSearch} />

      {/* Create Project Dialog */}
      <Dialog open={showNewProject} onOpenChange={(open) => { setShowNewProject(open); if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("topbar.newProject")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Name */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.name")}</label>
              <Input
                placeholder={t("project.namePlaceholder")}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="mt-1.5"
              />
            </div>

            {/* Alias */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.alias")}</label>
              <Input
                placeholder={t("project.aliasPlaceholder")}
                value={projectAlias}
                onChange={(e) => setProjectAlias(e.target.value)}
                className="mt-1.5"
              />
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.description")}</label>
              <textarea
                placeholder={t("project.descPlaceholder")}
                value={projectDesc}
                onChange={(e) => setProjectDesc(e.target.value)}
                rows={3}
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 resize-none"
              />
            </div>

            {/* Type toggle */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block" />
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
                  {t("project.normalType")}
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
                  {t("project.gitType")}
                </button>
              </div>
            </div>

            {/* Git URL (conditional) */}
            {projectType === "GIT" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t("project.gitUrl")}</label>
                <Input
                  placeholder={t("project.gitPlaceholder")}
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  className="mt-1.5"
                />
              </div>
            )}

            {/* Local Path */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.localPath")}</label>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("project.localPathHint")}</p>
              <div className="mt-1.5 flex gap-2">
                <Input
                  placeholder={t("project.localPathPlaceholder")}
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  className="flex-1 font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFolderBrowser(true)}
                  className="h-8 shrink-0"
                >
                  {t("folder.browse")}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowNewProject(false); resetForm(); }}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleCreateProject}
              disabled={!projectName.trim()}
              className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
            >
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder Browser Dialog */}
      <FolderBrowserDialog
        open={showFolderBrowser}
        onOpenChange={setShowFolderBrowser}
        onSelect={(path) => setLocalPath(path)}
        gitOnly={projectType === "GIT"}
      />
    </>
  );
}
