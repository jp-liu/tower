"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";
import type { FileEntry } from "@/actions/file-actions";

interface FileTreeContextMenuProps {
  entry: FileEntry;
  x: number;
  y: number;
  onClose: () => void;
  onNewFile: (entry: FileEntry) => void;
  onNewFolder: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
}

export function FileTreeContextMenu({
  entry,
  x,
  y,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: FileTreeContextMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const isGitDir =
    entry.name === ".git" || entry.relativePath === ".git";

  const itemClass =
    "flex items-center px-3 py-1.5 text-xs cursor-pointer hover:bg-accent rounded-sm w-full text-left";

  const menu = (
    <div
      ref={menuRef}
      style={{ position: "fixed", top: y, left: x, zIndex: 9999 }}
      className="bg-popover border border-border rounded-md shadow-md py-1 min-w-[160px]"
    >
      <button
        type="button"
        className={itemClass}
        onClick={() => { onNewFile(entry); onClose(); }}
      >
        {t("taskPage.fileTree.newFile")}
      </button>
      <button
        type="button"
        className={itemClass}
        onClick={() => { onNewFolder(entry); onClose(); }}
      >
        {t("taskPage.fileTree.newFolder")}
      </button>
      <hr className="my-1 border-border" />
      <button
        type="button"
        className={itemClass}
        onClick={() => { onRename(entry); onClose(); }}
      >
        {t("taskPage.fileTree.rename")}
      </button>
      {!isGitDir && (
        <>
          <hr className="my-1 border-border" />
          <button
            type="button"
            className={`${itemClass} text-destructive hover:bg-destructive/10`}
            onClick={() => { onDelete(entry); onClose(); }}
          >
            {t("taskPage.fileTree.delete")}
          </button>
        </>
      )}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(menu, document.body);
}
