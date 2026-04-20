"use client";

import { FileText, Eye, FolderOpen, Trash2 } from "lucide-react";
import { localPathToApiUrl } from "@/lib/file-serve-client";
import { useI18n } from "@/lib/i18n";

export interface AssetItemType {
  id: string;
  filename: string;
  path: string;
  mimeType: string | null;
  size: number | null;
  description: string | null;
  createdAt: Date;
  taskId?: string | null;
  taskTitle?: string | null;
}

interface AssetItemProps {
  asset: AssetItemType;
  onPreview: (asset: AssetItemType) => void;
  onReveal: (asset: AssetItemType) => void;
  onDelete: (assetId: string) => void;
  onTaskClick?: (taskId: string) => void;
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AssetItem({ asset, onPreview, onReveal, onDelete, onTaskClick }: AssetItemProps) {
  const { t } = useI18n();
  const url = localPathToApiUrl(asset.path);
  const isImage = asset.mimeType?.startsWith("image/");

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/20">
      {/* Preview / Icon — clickable */}
      <button onClick={() => onPreview(asset)} className="flex-shrink-0 cursor-pointer">
        {isImage ? (
          <img
            src={url}
            alt={asset.filename}
            className="h-12 w-12 rounded object-cover border border-border"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded border border-border bg-muted">
            <FileText className="h-6 w-6 text-muted-foreground" />
          </div>
        )}
      </button>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{asset.filename}</p>
          {asset.taskTitle && asset.taskId && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTaskClick?.(asset.taskId!);
              }}
              className="flex-shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs px-1.5 py-0.5 rounded cursor-pointer hover:bg-blue-500/20 transition-colors"
            >
              {asset.taskTitle.length > 20
                ? `[任务: ${asset.taskTitle.slice(0, 20)}...]`
                : `[任务: ${asset.taskTitle}]`}
            </button>
          )}
        </div>
        {asset.description && (
          <p className="mt-0.5 text-xs text-muted-foreground truncate">
            {asset.description}
          </p>
        )}
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{formatFileSize(asset.size)}</span>
          <span>{formatDate(asset.createdAt)}</span>
        </div>
      </div>

      {/* Actions: Preview, Reveal in Finder, Delete */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => onPreview(asset)}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("assets.preview")}
        >
          <Eye className="h-4 w-4" />
        </button>
        <button
          onClick={() => onReveal(asset)}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("assets.revealInFinder")}
        >
          <FolderOpen className="h-4 w-4" />
        </button>
        <button
          onClick={() => onDelete(asset.id)}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-rose-400"
          aria-label={t("assets.delete")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
