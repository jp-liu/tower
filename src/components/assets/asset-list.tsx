"use client";

import { FolderOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/empty-state";
import { AssetItem } from "./asset-item";
import type { AssetItemType } from "./asset-item";

interface AssetListProps {
  assets: AssetItemType[];
  onDelete: (assetId: string) => void;
}

export function AssetList({ assets, onDelete }: AssetListProps) {
  const { t } = useI18n();

  if (assets.length === 0) {
    return <EmptyState icon={FolderOpen} title={t("assets.empty")} description={t("assets.emptyHint")} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {assets.map((asset) => (
        <AssetItem key={asset.id} asset={asset} onDelete={onDelete} />
      ))}
    </div>
  );
}
