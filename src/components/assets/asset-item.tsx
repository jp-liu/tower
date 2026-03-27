"use client";

import { FileText, Download, Trash2 } from "lucide-react";
import { localPathToApiUrl } from "@/lib/file-serve";
import { useI18n } from "@/lib/i18n";

export interface AssetItemType {
  id: string;
  filename: string;
  path: string;
  mimeType: string | null;
  size: number | null;
  createdAt: Date;
}

interface AssetItemProps {
  asset: AssetItemType;
  onDelete: (assetId: string) => void;
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

export function AssetItem({ asset, onDelete }: AssetItemProps) {
  const { t } = useI18n();
  const url = localPathToApiUrl(asset.path);
  const isImage = asset.mimeType?.startsWith("image/");

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/20">
      {/* Preview / Icon */}
      <div className="flex-shrink-0">
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
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{asset.filename}</p>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{formatFileSize(asset.size)}</span>
          <span>{formatDate(asset.createdAt)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <a
          href={url}
          download={asset.filename}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("assets.download")}
        >
          <Download className="h-4 w-4" />
        </a>
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
