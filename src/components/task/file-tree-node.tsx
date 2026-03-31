"use client";

import { useRef, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileCode,
  FileJson,
  FileText,
  File,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { FileEntry } from "@/actions/file-actions";
import { useI18n } from "@/lib/i18n";

interface FileTreeNodeProps {
  entry: FileEntry;
  worktreePath: string;
  depth: number;
  gitStatusMap: Record<string, "M" | "A" | "D">;
  expandedPaths: Set<string>;
  childrenMap: Map<string, FileEntry[]>;
  selectedPath: string | null;
  onFileSelect: (absolutePath: string) => void;
  onToggleExpand: (relativePath: string) => void;
  onContextMenu: (entry: FileEntry, x: number, y: number) => void;
  renamingPath: string | null;
  onRenameSubmit: (entry: FileEntry, newName: string) => void;
  onRenameCancel: () => void;
  creatingIn: { parentPath: string; type: "file" | "folder" } | null;
  onCreateSubmit: (parentPath: string, name: string, type: "file" | "folder") => void;
  onCreateCancel: () => void;
}

function getFileIcon(name: string, isDirectory: boolean, isExpanded: boolean) {
  if (isDirectory) {
    return isExpanded ? (
      <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
    ) : (
      <Folder className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
    );
  }
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  if (ext === "ts" || ext === "tsx") {
    return <FileCode className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" />;
  }
  if (ext === "json") {
    return <FileJson className="h-3.5 w-3.5 flex-shrink-0 text-yellow-400" />;
  }
  if (ext === "md" || ext === "mdx") {
    return <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />;
  }
  if (ext === "css" || ext === "scss" || ext === "sass") {
    return <File className="h-3.5 w-3.5 flex-shrink-0 text-pink-400" />;
  }
  return <File className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />;
}

function getGitStatusColor(status: "M" | "A" | "D") {
  if (status === "M") return "text-amber-500 dark:text-amber-400";
  if (status === "A") return "text-emerald-500 dark:text-emerald-400";
  return "text-red-500 dark:text-red-400";
}

export function FileTreeNode({
  entry,
  worktreePath,
  depth,
  gitStatusMap,
  expandedPaths,
  childrenMap,
  selectedPath,
  onFileSelect,
  onToggleExpand,
  onContextMenu,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  creatingIn,
  onCreateSubmit,
  onCreateCancel,
}: FileTreeNodeProps) {
  const { t } = useI18n();
  const isExpanded = expandedPaths.has(entry.relativePath);
  const isSelected = selectedPath === entry.relativePath;
  const isRenaming = renamingPath === entry.relativePath;
  const gitStatus = gitStatusMap[entry.relativePath];
  const children = childrenMap.get(entry.relativePath) ?? [];
  const isCreatingHere =
    entry.isDirectory &&
    creatingIn?.parentPath === entry.relativePath &&
    isExpanded;

  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (isCreatingHere && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [isCreatingHere]);

  const handleClick = () => {
    if (entry.isDirectory) {
      onToggleExpand(entry.relativePath);
    } else {
      // Construct absolute path without Node's path module (client-safe)
      const base = worktreePath.endsWith("/") ? worktreePath.slice(0, -1) : worktreePath;
      const rel = entry.relativePath.startsWith("/") ? entry.relativePath.slice(1) : entry.relativePath;
      const absolutePath = `${base}/${rel}`;
      onFileSelect(absolutePath);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(entry, e.clientX, e.clientY);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const newName = e.currentTarget.value.trim();
      if (newName && newName !== entry.name) {
        onRenameSubmit(entry, newName);
      } else {
        onRenameCancel();
      }
    } else if (e.key === "Escape") {
      onRenameCancel();
    }
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const name = e.currentTarget.value.trim();
      if (name && creatingIn) {
        onCreateSubmit(creatingIn.parentPath, name, creatingIn.type);
      } else {
        onCreateCancel();
      }
    } else if (e.key === "Escape") {
      onCreateCancel();
    }
  };

  const rowClass = [
    "flex items-center gap-1 py-0.5 px-1 cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-sm min-h-[28px]",
    isSelected ? "bg-secondary text-secondary-foreground font-medium" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const indentStyle = { paddingLeft: `calc(${depth} * 8px + 4px)` };

  return (
    <div>
      {/* Node row */}
      <div
        className={rowClass}
        style={indentStyle}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        role="treeitem"
        aria-expanded={entry.isDirectory ? isExpanded : undefined}
      >
        {/* Expand chevron for directories */}
        {entry.isDirectory ? (
          <span className="flex-shrink-0">
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 transition-transform duration-150" />
            ) : (
              <ChevronRight className="h-3 w-3 transition-transform duration-150" />
            )}
          </span>
        ) : (
          <span className="h-3 w-3 flex-shrink-0" />
        )}

        {/* File/folder icon */}
        {getFileIcon(entry.name, entry.isDirectory, isExpanded)}

        {/* Name or rename input */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            defaultValue={entry.name}
            className="ring-1 ring-primary rounded-sm px-1 text-[13px] w-full bg-background"
            placeholder={t("taskPage.fileTree.renamePlaceholder")}
            onKeyDown={handleRenameKeyDown}
            onBlur={onRenameCancel}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-[13px] truncate flex-1">{entry.name}</span>
        )}

        {/* Git status badge */}
        {gitStatus && !isRenaming && (
          <span className={`ml-auto text-[11px] font-normal ${getGitStatusColor(gitStatus)}`}>
            {gitStatus}
          </span>
        )}
      </div>

      {/* Children (expanded directories) */}
      {entry.isDirectory && isExpanded && (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={child.relativePath}
              entry={child}
              worktreePath={worktreePath}
              depth={depth + 1}
              gitStatusMap={gitStatusMap}
              expandedPaths={expandedPaths}
              childrenMap={childrenMap}
              selectedPath={selectedPath}
              onFileSelect={onFileSelect}
              onToggleExpand={onToggleExpand}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              creatingIn={creatingIn}
              onCreateSubmit={onCreateSubmit}
              onCreateCancel={onCreateCancel}
            />
          ))}

          {/* Ghost row for inline create */}
          {isCreatingHere && (
            <div
              className="flex items-center gap-1 py-0.5 px-1 min-h-[28px]"
              style={{ paddingLeft: `calc(${depth + 1} * 8px + 4px)` }}
            >
              <span className="h-3 w-3 flex-shrink-0" />
              {creatingIn?.type === "folder" ? (
                <Folder className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
              ) : (
                <File className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              )}
              <input
                ref={createInputRef}
                type="text"
                className="ring-1 ring-primary rounded-sm px-1 text-[13px] w-full bg-background"
                placeholder={
                  creatingIn?.type === "folder"
                    ? t("taskPage.fileTree.newFolderPlaceholder")
                    : t("taskPage.fileTree.newFilePlaceholder")
                }
                onKeyDown={handleCreateKeyDown}
                onBlur={onCreateCancel}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
