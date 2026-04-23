"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Folder, FolderGit2, Home, ChevronUp, Search, HardDrive } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FolderEntry {
  name: string;
  path: string;
  isGit: boolean;
}

interface BrowseResult {
  currentPath: string;
  parentPath: string;
  homePath: string;
  folders: FolderEntry[];
  drives?: FolderEntry[];
}

interface FolderBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  gitOnly?: boolean;
}

export function FolderBrowserDialog({
  open,
  onOpenChange,
  onSelect,
  gitOnly = false,
}: FolderBrowserDialogProps) {
  const { t } = useI18n();
  const [data, setData] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState("");
  const [filterText, setFilterText] = useState("");
  const [showDrives, setShowDrives] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const browse = useCallback(async (dirPath?: string) => {
    setLoading(true);
    setError(null);
    setFilterText("");
    setShowDrives(false);
    try {
      const url = dirPath
        ? `/api/browse-fs?path=${encodeURIComponent(dirPath)}`
        : "/api/browse-fs";
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed");
        return;
      }
      const result: BrowseResult = await res.json();
      setData(result);
      setManualPath(result.currentPath);
    } catch {
      setError("Failed to browse filesystem");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      browse();
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open, browse]);

  const handleGoTo = () => {
    if (manualPath.trim()) browse(manualPath.trim());
  };

  const handleSelectCurrent = () => {
    if (data?.currentPath) {
      onSelect(data.currentPath);
      onOpenChange(false);
    }
  };

  const handleSelectFolder = (folder: FolderEntry) => {
    if (folder.isGit || gitOnly) {
      // If it's a git repo or we're in gitOnly mode, select it directly
      onSelect(folder.path);
      onOpenChange(false);
    } else {
      // Navigate into the folder
      browse(folder.path);
    }
  };

  const handleGoUp = () => {
    if (!data) return;
    if (data.parentPath === "__DRIVES__") {
      // At drive root on Windows — show drives list
      setShowDrives(true);
    } else {
      setShowDrives(false);
      browse(data.parentPath);
    }
  };

  const handleDriveSelect = (drivePath: string) => {
    setShowDrives(false);
    browse(drivePath);
  };

  const filtered = data?.folders.filter((f) =>
    f.name.toLowerCase().includes(filterText.toLowerCase())
  ) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0" style={{ maxWidth: '36rem', overflow: 'hidden' }}>
        <div className="flex flex-col max-h-[60vh] overflow-hidden">
          <div className="px-5 pt-5 pb-3 shrink-0">
            <DialogTitle>{gitOnly ? t("folder.selectGitRepo") : t("folder.selectFolder")}</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">{t("folder.hint")}</p>
          </div>

          {/* Manual path input */}
          <div className="border-t border-border px-4 pt-3 pb-2 shrink-0">
            <label className="text-xs font-medium text-muted-foreground">{t("folder.manualInput")}</label>
            <div className="mt-1.5 flex gap-2">
              <Input
                ref={inputRef}
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGoTo()}
                placeholder="/path/to/your/project"
                title={manualPath}
                className="flex-1 min-w-0"
              />
              <Button
                variant="outline"
               
                onClick={handleGoTo}
                className="h-8 px-3 shrink-0"
              >
                {t("folder.goTo")}
              </Button>
            </div>
          </div>

          {/* Filter */}
          <div className="px-4 py-2 shrink-0">
            <label className="text-xs font-medium text-muted-foreground">{t("folder.searchDir")}</label>
            <div className="relative mt-1.5">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter folders and files..."
                className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {/* Navigation bar */}
          <div className="flex items-center gap-1.5 border-y border-border px-4 py-2 shrink-0 min-w-0">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => data?.homePath && browse(data.homePath)}
              className="shrink-0 text-muted-foreground"
              title="Home"
            >
              <Home className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={handleGoUp}
              className="shrink-0 text-muted-foreground"
              title="Parent"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            {data?.drives && data.drives.length > 0 && (
              <Button
                variant={showDrives ? "default" : "outline"}
                size="icon-sm"
                onClick={() => setShowDrives((v) => !v)}
                className="shrink-0 text-muted-foreground"
                title="Drives"
              >
                <HardDrive className="h-3.5 w-3.5" />
              </Button>
            )}
            <div className="min-w-0 flex-1 truncate text-sm text-foreground font-mono" title={data?.currentPath ?? ""}>
              {data?.currentPath ?? "..."}
            </div>
          </div>

          {/* Folder list */}
          <ScrollArea className="min-h-0 flex-1">
            {loading && (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                Loading...
              </div>
            )}
            {error && (
              <div className="flex items-center justify-center py-8 text-sm text-rose-400">
                {error}
              </div>
            )}
            {/* Windows drive list */}
            {showDrives && data?.drives && data.drives.map((drive) => (
              <button
                key={drive.path}
                onClick={() => handleDriveSelect(drive.path)}
                className="flex w-full items-center gap-3 border-b border-border/30 px-4 py-2.5 text-left transition-colors hover:bg-accent last:border-b-0"
              >
                <HardDrive className="h-4 w-4 text-blue-400 shrink-0" />
                <span className="flex-1 text-sm text-foreground truncate">{drive.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{drive.path}</span>
              </button>
            ))}
            {!showDrives && !loading && !error && filtered.length === 0 && (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                {t("folder.empty")}
              </div>
            )}
            {!showDrives && !loading && !error && filtered.map((folder) => (
              <button
                key={folder.path}
                onClick={() => handleSelectFolder(folder)}
                onDoubleClick={() => browse(folder.path)}
                className="flex w-full items-center gap-3 border-b border-border/30 px-4 py-2.5 text-left transition-colors hover:bg-accent last:border-b-0"
              >
                {folder.isGit ? (
                  <FolderGit2 className="h-4 w-4 text-emerald-400 shrink-0" />
                ) : (
                  <Folder className="h-4 w-4 text-primary/70 shrink-0" />
                )}
                <span className="flex-1 text-sm text-foreground truncate">{folder.name}</span>
                {folder.isGit && (
                  <span className="shrink-0 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-500/20">
                    git
                  </span>
                )}
              </button>
            ))}
          </ScrollArea>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-3 shrink-0 border-t border-border">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={handleSelectCurrent}
              className="bg-primary/10 text-primary ring-1 ring-primary/20 hover:bg-primary/15"
            >
              {t("folder.selectPath")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
