"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { FolderTree, AlertCircle, Folder, Search, X, FileIcon } from "lucide-react";
import Fuse from "fuse.js";
import { EmptyState } from "@/components/ui/empty-state";
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
import { listDirectory, getGitStatus, createFile, createDirectory, renameEntry, deleteEntry, listAllFiles } from "@/actions/file-actions";
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
  // File search state
  const [searchQuery, setSearchQuery] = useState("");
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [allFilesLoaded, setAllFilesLoaded] = useState(false);
  const [searchHighlight, setSearchHighlight] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);

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

    // Load git status — branch diff (worktree mode) or working tree status (direct mode)
    getGitStatus(worktreePath, baseBranch, worktreeBranch)
      .then(setGitStatusMap)
      .catch(() => setGitStatusMap({}));
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

  // Load all file paths for search (lazy: only when user starts typing)
  const loadAllFiles = useCallback(async () => {
    if (!worktreePath || allFilesLoaded) return;
    try {
      const files = await listAllFiles(worktreePath);
      setAllFiles(files);
      setAllFilesLoaded(true);
    } catch {
      // Silently fail — search just won't work
    }
  }, [worktreePath, allFilesLoaded]);

  // Reset file list when worktree changes
  useEffect(() => {
    setAllFiles([]);
    setAllFilesLoaded(false);
    setSearchQuery("");
  }, [worktreePath]);

  const fuse = useMemo(
    () =>
      new Fuse(allFiles, {
        threshold: 0.4,
        distance: 200,
        includeMatches: true,
      }),
    [allFiles]
  );

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return fuse.search(searchQuery.trim(), { limit: 30 });
  }, [fuse, searchQuery]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchQuery("");
        searchInputRef.current?.blur();
        return;
      }
      if (!searchResults.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSearchHighlight((prev) => Math.min(prev + 1, searchResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSearchHighlight((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = searchResults[searchHighlight];
        if (hit) {
          const abs = `${worktreePath}/${hit.item}`;
          handleFileSelect(abs);
          setSearchQuery("");
        }
      }
    },
    [searchResults, searchHighlight, worktreePath, handleFileSelect]
  );

  // Scroll highlighted search result into view
  useEffect(() => {
    const container = searchResultsRef.current;
    if (!container) return;
    const highlighted = container.querySelector("[data-highlighted='true']");
    if (highlighted) {
      highlighted.scrollIntoView({ block: "nearest" });
    }
  }, [searchHighlight]);

  // Empty state: no worktreePath
  if (!worktreePath) {
    return (
      <EmptyState
        icon={FolderTree}
        title={t("taskPage.fileTree.emptyHeading")}
        description={t("taskPage.fileTree.emptyBody")}
        className="h-full"
      />
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
      <EmptyState
        icon={Folder}
        title={t("taskPage.fileTree.emptyDir")}
        className="h-full"
      />
    );
  }

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Search input */}
      <div className="flex-shrink-0 px-2 py-1.5 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            placeholder={t("taskPage.fileTree.searchPlaceholder")}
            className="w-full h-7 pl-7 pr-7 text-xs bg-muted/50 border border-border rounded-md outline-none focus:border-primary/50 focus:bg-background transition-colors placeholder:text-muted-foreground/60"
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchHighlight(0);
              if (!allFilesLoaded) loadAllFiles();
            }}
            onKeyDown={handleSearchKeyDown}
          />
          {isSearching && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted-foreground/20 text-muted-foreground"
              onClick={() => setSearchQuery("")}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Thin loading indicator */}
      {isLoading && (
        <div className="h-0.5 w-full bg-primary/30 animate-pulse flex-shrink-0" />
      )}

      {/* Search results */}
      {isSearching ? (
        <ScrollArea className="flex-1">
          <div ref={searchResultsRef} className="py-1">
            {searchResults.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                {t("taskPage.fileTree.searchNoResults")}
              </p>
            ) : (
              searchResults.map((result, index) => {
                const fullPath = result.item;
                const fileName = fullPath.split("/").pop() ?? fullPath;
                const dirPath = fullPath.includes("/")
                  ? fullPath.slice(0, fullPath.lastIndexOf("/"))
                  : "";

                // Build highlight ranges for the full path
                const matchedIndices = new Set<number>();
                if (result.matches) {
                  for (const m of result.matches) {
                    for (const [start, end] of m.indices) {
                      for (let i = start; i <= end; i++) matchedIndices.add(i);
                    }
                  }
                }

                // Split offset: fileName starts at this index in the full path
                const fileNameOffset = fullPath.length - fileName.length;

                const highlightText = (text: string, offset: number) => {
                  const segments: React.ReactNode[] = [];
                  let i = 0;
                  while (i < text.length) {
                    const isMatch = matchedIndices.has(i + offset);
                    let j = i + 1;
                    while (j < text.length && matchedIndices.has(j + offset) === isMatch) j++;
                    const slice = text.slice(i, j);
                    segments.push(
                      isMatch ? (
                        <span key={i} className="text-primary font-semibold">{slice}</span>
                      ) : (
                        <span key={i}>{slice}</span>
                      )
                    );
                    i = j;
                  }
                  return segments;
                };

                return (
                  <button
                    key={fullPath}
                    type="button"
                    data-highlighted={index === searchHighlight}
                    className={`w-full flex items-center gap-2 px-3 py-1 text-left text-xs hover:bg-accent cursor-pointer ${
                      index === searchHighlight ? "bg-accent" : ""
                    }`}
                    onClick={() => {
                      const abs = `${worktreePath}/${fullPath}`;
                      handleFileSelect(abs);
                      setSearchQuery("");
                    }}
                    onMouseEnter={() => setSearchHighlight(index)}
                  >
                    <FileIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      <span className="text-foreground">{highlightText(fileName, fileNameOffset)}</span>
                      {dirPath && (
                        <span className="ml-1.5 text-muted-foreground">{highlightText(dirPath, 0)}</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      ) : (
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
      )}

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
          onRevealInFinder={worktreePath ? (entry) => {
            import("@/actions/file-actions").then(({ revealInFinder }) => {
              revealInFinder(worktreePath, entry.relativePath).catch(() => {});
            });
          } : undefined}
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
