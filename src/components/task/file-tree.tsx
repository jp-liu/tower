"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FolderTree, AlertCircle, Folder } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { listDirectory, getGitStatus, createFile, createDirectory, renameEntry, deleteEntry } from "@/actions/file-actions";
import type { FileEntry } from "@/actions/file-actions";
import { FileTreeNode } from "./file-tree-node";
import { FileTreeContextMenu } from "./file-tree-context-menu";

interface FileTreeProps {
  worktreePath: string | null;
  baseBranch: string | null;
  worktreeBranch: string | null;
  executionStatus: string;
  onFileSelect: (absolutePath: string) => void;
}

export function FileTree({
  worktreePath,
  baseBranch,
  worktreeBranch,
  executionStatus,
  onFileSelect,
}: FileTreeProps) {
  const { t } = useI18n();
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Map<string, FileEntry[]>>(new Map());
  const [gitStatusMap, setGitStatusMap] = useState<Record<string, "M" | "A" | "D">>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<{ parentPath: string; type: "file" | "folder" } | null>(null);
  const [menuState, setMenuState] = useState<{ entry: FileEntry; x: number; y: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const expandedPathsRef = useRef(expandedPaths);
  expandedPathsRef.current = expandedPaths;

  const loadRoot = useCallback(async () => {
    if (!worktreePath) return;
    try {
      const entries = await listDirectory(worktreePath, ".");
      setRootEntries(entries);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [worktreePath]);

  const loadChildren = useCallback(
    async (relativePath: string) => {
      if (!worktreePath) return;
      try {
        const entries = await listDirectory(worktreePath, relativePath);
        setChildrenMap((prev) => {
          const next = new Map(prev);
          next.set(relativePath, entries);
          return next;
        });
      } catch {
        // Silently fail for subdirectory loads
      }
    },
    [worktreePath]
  );

  const refreshTree = useCallback(async () => {
    if (!worktreePath) return;
    try {
      const entries = await listDirectory(worktreePath, ".");
      setRootEntries(entries);
      // Refresh all expanded paths without clearing expandedPaths
      const currentExpanded = expandedPathsRef.current;
      for (const rel of currentExpanded) {
        const children = await listDirectory(worktreePath, rel).catch(() => null);
        if (children) {
          setChildrenMap((prev) => {
            const next = new Map(prev);
            next.set(rel, children);
            return next;
          });
        }
      }
    } catch {
      // Silently degrade on refresh failure
    }
  }, [worktreePath]);

  // Initial load
  useEffect(() => {
    if (!worktreePath) return;
    setIsLoading(true);
    setLoadError(false);
    setRootEntries([]);
    setChildrenMap(new Map());
    setExpandedPaths(new Set());
    setSelectedPath(null);

    loadRoot().finally(() => setIsLoading(false));

    // Load git status if branches provided
    if (baseBranch && worktreeBranch) {
      getGitStatus(worktreePath, baseBranch, worktreeBranch)
        .then(setGitStatusMap)
        .catch(() => setGitStatusMap({}));
    }
  }, [worktreePath, baseBranch, worktreeBranch, loadRoot]);

  // Auto-refresh while RUNNING
  useEffect(() => {
    if (executionStatus !== "RUNNING") return;
    const interval = setInterval(refreshTree, 2000);
    return () => clearInterval(interval);
  }, [executionStatus, refreshTree]);

  const handleToggleExpand = useCallback(
    (relativePath: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(relativePath)) {
          next.delete(relativePath);
        } else {
          next.add(relativePath);
          // Lazy load children on first expand
          if (!childrenMap.has(relativePath)) {
            loadChildren(relativePath);
          }
        }
        return next;
      });
    },
    [childrenMap, loadChildren]
  );

  const handleFileSelect = useCallback(
    (absolutePath: string) => {
      const base = (worktreePath ?? "").endsWith("/") ? worktreePath ?? "" : `${worktreePath ?? ""}/`;
      const rel = absolutePath.startsWith(base) ? absolutePath.slice(base.length) : absolutePath;
      setSelectedPath(rel);
      onFileSelect(absolutePath);
    },
    [worktreePath, onFileSelect]
  );

  const handleContextMenu = useCallback(
    (entry: FileEntry, x: number, y: number) => {
      setMenuState({ entry, x, y });
    },
    []
  );

  const handleNewFile = useCallback(
    (entry: FileEntry) => {
      const parentPath = entry.isDirectory
        ? entry.relativePath
        : (entry.relativePath.includes("/") ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/")) : ".");
      setCreatingIn({ parentPath, type: "file" });
      // Expand parent if needed
      if (entry.isDirectory) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.add(entry.relativePath);
          return next;
        });
        if (!childrenMap.has(entry.relativePath)) {
          loadChildren(entry.relativePath);
        }
      }
    },
    [childrenMap, loadChildren]
  );

  const handleNewFolder = useCallback(
    (entry: FileEntry) => {
      const parentPath = entry.isDirectory
        ? entry.relativePath
        : (entry.relativePath.includes("/") ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/")) : ".");
      setCreatingIn({ parentPath, type: "folder" });
      if (entry.isDirectory) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.add(entry.relativePath);
          return next;
        });
        if (!childrenMap.has(entry.relativePath)) {
          loadChildren(entry.relativePath);
        }
      }
    },
    [childrenMap, loadChildren]
  );

  const handleRename = useCallback((entry: FileEntry) => {
    setRenamingPath(entry.relativePath);
  }, []);

  const handleDelete = useCallback((entry: FileEntry) => {
    setDeleteTarget(entry);
  }, []);

  const handleRenameSubmit = useCallback(
    async (entry: FileEntry, newName: string) => {
      if (!worktreePath) return;
      setRenamingPath(null);
      const parentDir = entry.relativePath.includes("/")
        ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/"))
        : ".";
      const newRelative = parentDir === "." ? newName : `${parentDir}/${newName}`;
      try {
        await renameEntry(worktreePath, entry.relativePath, newRelative);
        await refreshTree();
      } catch {
        // Silently fail rename
      }
    },
    [worktreePath, refreshTree]
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);
  }, []);

  const handleCreateSubmit = useCallback(
    async (parentPath: string, name: string, type: "file" | "folder") => {
      if (!worktreePath) return;
      setCreatingIn(null);
      const relativePath = parentPath === "." ? name : `${parentPath}/${name}`;
      try {
        if (type === "file") {
          await createFile(worktreePath, relativePath);
        } else {
          await createDirectory(worktreePath, relativePath);
        }
        await refreshTree();
      } catch {
        // Silently fail create
      }
    },
    [worktreePath, refreshTree]
  );

  const handleCreateCancel = useCallback(() => {
    setCreatingIn(null);
  }, []);

  const handleDeleteConfirm = async () => {
    if (!worktreePath || !deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteEntry(worktreePath, target.relativePath);
      await refreshTree();
    } catch {
      // Silently fail delete
    }
  };

  // Empty state: no worktreePath
  if (!worktreePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <FolderTree className="h-8 w-8 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">
            {t("taskPage.fileTree.emptyHeading")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("taskPage.fileTree.emptyBody")}
          </p>
        </div>
      </div>
    );
  }

  // Load error state
  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">
          {t("taskPage.fileTree.loadError")}
        </p>
        <button
          type="button"
          className="text-xs text-primary underline cursor-pointer"
          onClick={() => { setLoadError(false); setIsLoading(true); loadRoot().finally(() => setIsLoading(false)); }}
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty directory state
  if (!isLoading && rootEntries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Folder className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t("taskPage.fileTree.emptyDir")}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Thin loading indicator */}
      {isLoading && (
        <div className="h-0.5 w-full bg-primary/30 animate-pulse flex-shrink-0" />
      )}

      <ScrollArea className="flex-1">
        <div className="py-1">
          {rootEntries.map((entry) => (
            <FileTreeNode
              key={entry.relativePath}
              entry={entry}
              worktreePath={worktreePath}
              depth={0}
              gitStatusMap={gitStatusMap}
              expandedPaths={expandedPaths}
              childrenMap={childrenMap}
              selectedPath={selectedPath}
              onFileSelect={handleFileSelect}
              onToggleExpand={handleToggleExpand}
              onContextMenu={handleContextMenu}
              renamingPath={renamingPath}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={handleRenameCancel}
              creatingIn={creatingIn}
              onCreateSubmit={handleCreateSubmit}
              onCreateCancel={handleCreateCancel}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Context menu */}
      {menuState && (
        <FileTreeContextMenu
          entry={menuState.entry}
          x={menuState.x}
          y={menuState.y}
          onClose={() => setMenuState(null)}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("taskPage.fileTree.deleteConfirmHeading")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTarget?.isDirectory
              ? t("taskPage.fileTree.deleteConfirmBodyFolder", { name: deleteTarget.name })
              : t("taskPage.fileTree.deleteConfirmBody", { name: deleteTarget?.name ?? "" })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              {t("taskPage.fileTree.deleteConfirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
