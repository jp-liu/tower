"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import type { TaskStatus } from "@prisma/client";
import { useI18n } from "@/lib/i18n";
import { BOARD_COLUMNS } from "@/lib/constants";

interface TaskCardContextMenuProps {
  x: number;
  y: number;
  taskId: string;
  currentStatus: TaskStatus;
  hasExecutions: boolean;
  workspaceId: string;
  onClose: () => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onLaunch: (taskId: string) => void;
}

export function TaskCardContextMenu({
  x,
  y,
  taskId,
  currentStatus,
  hasExecutions,
  workspaceId,
  onClose,
  onStatusChange,
  onLaunch,
}: TaskCardContextMenuProps) {
  const { t } = useI18n();
  const router = useRouter();
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

  const itemClass =
    "flex items-center px-3 py-1.5 text-xs cursor-pointer hover:bg-accent rounded-sm w-full text-left";

  const menu = (
    <div
      ref={menuRef}
      style={{ position: "fixed", top: y, left: x, zIndex: 9999 }}
      className="bg-popover border border-border rounded-md shadow-md py-1 min-w-[180px]"
    >
      <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">
        {t("board.contextMenu.changeStatus")}
      </div>
      {BOARD_COLUMNS.map((col) => (
        <button
          key={col.id}
          type="button"
          className={itemClass}
          onClick={() => {
            onStatusChange(taskId, col.id);
            onClose();
          }}
        >
          {currentStatus === col.id ? (
            <Check className="h-3 w-3 mr-2 flex-shrink-0" />
          ) : (
            <span className="w-5 flex-shrink-0" />
          )}
          {col.label}
        </button>
      ))}
      <hr className="my-1 border-border" />
      <button
        type="button"
        className={`${itemClass} ${hasExecutions ? "opacity-50 cursor-not-allowed" : ""}`}
        disabled={hasExecutions}
        onClick={() => {
          if (!hasExecutions) {
            onLaunch(taskId);
            onClose();
          }
        }}
      >
        {t("board.contextMenu.launch")}
      </button>
      <hr className="my-1 border-border" />
      <button
        type="button"
        className={itemClass}
        onClick={() => {
          router.push(`/workspaces/${workspaceId}/tasks/${taskId}`);
          onClose();
        }}
      >
        {t("board.contextMenu.goToDetail")}
      </button>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(menu, document.body);
}
