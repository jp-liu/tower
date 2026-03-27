"use client";

import { FolderOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { AssetItem } from "./asset-item";
import type { AssetItemType } from "./asset-item";

interface AssetListProps {
  assets: AssetItemType[];
  onDelete: (assetId: string) => void;
}

export function AssetList({ assets, onDelete }: AssetListProps) {
  const { t } = useI18n();

  if (assets.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
        <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">{t("assets.empty")}</p>
        <p className="text-xs text-muted-foreground/60">{t("assets.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {assets.map((asset) => (
        <AssetItem key={asset.id} asset={asset} onDelete={onDelete} />
      ))}
    </div>
  );
}
