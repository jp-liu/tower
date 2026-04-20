"use client";

import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FolderBrowserDialog } from "@/components/layout/folder-browser-dialog";
import { useI18n } from "@/lib/i18n";

interface CreateProjectData {
  name: string;
  alias?: string;
  description?: string;
  gitUrl?: string;
  localPath?: string;
  projectType?: "FRONTEND" | "BACKEND";
}

interface ImportProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateProject?: (data: CreateProjectData) => Promise<void> | void;
}

export function ImportProjectDialog({
  open,
  onOpenChange,
  onCreateProject,
}: ImportProjectDialogProps) {
  const { t } = useI18n();
  const [projectName, setProjectName] = useState("");
  const [projectAlias, setProjectAlias] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [projectType, setProjectType] = useState<"FRONTEND" | "BACKEND">("FRONTEND");
  const [gitDetected, setGitDetected] = useState(false);

  const resetForm = () => {
    setProjectName("");
    setProjectAlias("");
    setProjectDesc("");
    setGitUrl("");
    setLocalPath("");
    setProjectType("FRONTEND");
    setGitDetected(false);
  };

  const handleFolderSelect = async (selectedPath: string) => {
    setLocalPath(selectedPath);
    setGitDetected(false);

    // Derive default project name from folder basename
    const basename = selectedPath.split("/").filter(Boolean).pop() ?? "";
    setProjectName(basename);

    // Auto-detect git remote
    try {
      const res = await fetch(`/api/git?path=${encodeURIComponent(selectedPath)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.isGit && data.remoteUrl) {
          setGitUrl(data.remoteUrl);
          setGitDetected(true);
          // Use repo name from remote if available
          const repoMatch = data.remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
          if (repoMatch) {
            setProjectName(repoMatch[1]);
          }
        }
      }
    } catch {
      // Not a git repo or path doesn't exist — that's fine
    }
  };

  const handleCreate = async () => {
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
      onOpenChange(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}
        disablePointerDismissal
      >
        <DialogContent style={{ maxWidth: "32rem" }}>
          <DialogHeader>
            <DialogTitle>{t("topbar.importProject")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Browse folder — primary action */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.localPath")}</label>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("project.importHint")}</p>
              <div className="mt-1.5 flex gap-2">
                <Input
                  value={localPath}
                  readOnly
                  placeholder={t("project.localPathPlaceholder")}
                  className="flex-1 font-mono text-xs bg-muted/30"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowFolderBrowser(true)}
                  className="shrink-0 gap-1.5"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t("folder.browse")}
                </Button>
              </div>
              {gitDetected && (
                <p className="mt-1.5 text-[11px] text-emerald-400">{t("project.autoDetected")}</p>
              )}
            </div>

            {/* Git URL (auto-filled, editable) */}
            {gitUrl && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t("project.gitUrl")}</label>
                <Input
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  className="mt-1.5 font-mono text-xs"
                />
              </div>
            )}

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

            {/* Project type */}
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { onOpenChange(false); resetForm(); }}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!projectName.trim() || !localPath.trim()}
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
        onSelect={(p) => handleFolderSelect(p)}
      />
    </>
  );
}
