"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Search, Settings, Plus, Command, Globe, Sun, Moon, GitBranch, Loader2, Check, AlertCircle, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SegmentedControl } from "@/components/ui/segmented-control";
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
import { useAssistant } from "@/components/assistant/assistant-provider";
import { toCloneUrl } from "@/lib/git-url";
import { resolveGitLocalPath } from "@/actions/config-actions";

interface CreateProjectData {
  name: string;
  alias?: string;
  description?: string;
  gitUrl?: string;
  localPath?: string;
  projectType?: "FRONTEND" | "BACKEND";
}

interface TopBarProps {
  onCreateProject?: (data: CreateProjectData) => Promise<void> | void;
}

export function TopBar({ onCreateProject }: TopBarProps) {
  const { t, locale, setLocale } = useI18n();
  const { isOpen: assistantOpen, toggleAssistant } = useAssistant();
  const [showSearch, setShowSearch] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectAlias, setProjectAlias] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [localPathManual, setLocalPathManual] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [projectType, setProjectType] = useState<"FRONTEND" | "BACKEND">("FRONTEND");
  const [cloneStatus, setCloneStatus] = useState<"idle" | "cloning" | "success" | "error">("idle");
  const [cloneError, setCloneError] = useState("");

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
    setGitUrl("");
    setLocalPath("");
    setLocalPathManual(false);
    setProjectType("FRONTEND");
    setCloneStatus("idle");
    setCloneError("");
  };

  const handleGitUrlChange = async (value: string) => {
    setGitUrl(value);
    setCloneStatus("idle");
    setCloneError("");
    if (!localPathManual) {
      const path = await resolveGitLocalPath(value);
      setLocalPath(path);
    }
  };

  const handleClone = async () => {
    if (!gitUrl.trim() || !localPath.trim()) return;
    setCloneStatus("cloning");
    setCloneError("");
    try {
      const cloneUrl = toCloneUrl(gitUrl.trim());
      const res = await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clone", url: cloneUrl, path: localPath.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCloneStatus("error");
        setCloneError(data.error || "Clone failed");
        return;
      }
      setCloneStatus("success");
    } catch {
      setCloneStatus("error");
      setCloneError("Network error");
    }
  };

  const handleLocalPathChange = async (value: string) => {
    setLocalPath(value);
    setLocalPathManual(true);
    // Auto-detect git remote if local path is a git repo
    if (value.trim() && !gitUrl.trim()) {
      try {
        const res = await fetch(`/api/git?path=${encodeURIComponent(value.trim())}`);
        if (res.ok) {
          const data = await res.json();
          if (data.isGit && data.remoteUrl) {
            setGitUrl(data.remoteUrl);
          }
        }
      } catch {
        // ignore — not a git repo or path doesn't exist yet
      }
    }
  };

  const handleCreateProject = async () => {
    if (projectName.trim()) {
      await onCreateProject?.({
        name: projectName.trim(),
        alias: projectAlias.trim() || undefined,
        description: projectDesc.trim() || undefined,
        gitUrl: gitUrl.trim() || undefined,
        localPath: localPath.trim() || undefined,
        projectType,
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
          <span className="flex-1 text-left" suppressHydrationWarning>{t("topbar.searchPlaceholder")}</span>
          <kbd className="flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </button>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5">
          {/* Assistant */}
          <button
            onClick={toggleAssistant}
            aria-label="Assistant ⌘L"
            className={[
              "rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              assistantOpen ? "bg-accent text-foreground" : "",
            ].join(" ")}
          >
            <Bot className="h-4 w-4" />
          </button>

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
            className="gap-1.5 bg-primary/10 text-primary ring-1 ring-primary/25 hover:bg-primary/20"
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
      <Dialog open={showNewProject} onOpenChange={(open) => { setShowNewProject(open); if (!open) resetForm(); }} disablePointerDismissal>
        <DialogContent style={{ maxWidth: '32rem' }}>
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

            {/* Project type — D-01 */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.type.label")}</label>
              <div className="mt-1.5">
                <SegmentedControl
                  options={[
                    { value: "FRONTEND" as const, label: t("project.type.frontend") },
                    { value: "BACKEND" as const, label: t("project.type.backend") },
                  ]}
                  value={projectType}
                  onChange={setProjectType}
                />
              </div>
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

            {/* Git URL */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.gitUrl")}</label>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("project.gitUrlHint")}</p>
              <Input
                placeholder={t("project.gitPlaceholder")}
                value={gitUrl}
                onChange={(e) => handleGitUrlChange(e.target.value)}
                className="mt-1.5 font-mono text-xs"
              />
            </div>

            {/* Local Path */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.localPath")}</label>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("project.localPathHint")}</p>
              <div className="mt-1.5 flex gap-2">
                <Input
                  placeholder={t("project.localPathPlaceholder")}
                  value={localPath}
                  onChange={(e) => handleLocalPathChange(e.target.value)}
                  className="flex-1 font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowFolderBrowser(true)}
                  className="shrink-0"
                >
                  {t("folder.browse")}
                </Button>
              </div>

              {/* Clone button */}
              {gitUrl.trim() && localPath.trim() && (
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    disabled={cloneStatus === "cloning" || cloneStatus === "success"}
                    onClick={handleClone}
                    className="gap-1.5 text-xs bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    {cloneStatus === "cloning" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : cloneStatus === "success" ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <GitBranch className="h-3 w-3" />
                    )}
                    {cloneStatus === "cloning" ? t("git.cloning") : cloneStatus === "success" ? t("git.cloned") : t("git.clone")}
                  </Button>
                  {cloneStatus === "error" && (
                    <span className="flex items-center gap-1 text-[11px] text-rose-400">
                      <AlertCircle className="h-3 w-3" />
                      {cloneError}
                    </span>
                  )}
                  {cloneStatus === "success" && (
                    <span className="text-[11px] text-emerald-400">{t("git.cloneSuccess")}</span>
                  )}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowNewProject(false); resetForm(); }}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleCreateProject}
              disabled={!projectName.trim()}
              className="bg-primary/10 text-primary ring-1 ring-primary/25 hover:bg-primary/20"
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
        onSelect={(p) => handleLocalPathChange(p)}
      />
    </>
  );
}
