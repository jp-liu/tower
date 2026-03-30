"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, FolderOpen } from "lucide-react";
import type { ProjectAsset } from "@prisma/client";
import { useI18n } from "@/lib/i18n";
import { deleteAsset, getProjectAssets } from "@/actions/asset-actions";
import { AssetList } from "@/components/assets/asset-list";
import { AssetUpload } from "@/components/assets/asset-upload";

interface SimpleProject {
  id: string;
  name: string;
  alias: string | null;
}

interface SimpleWorkspace {
  id: string;
  name: string;
  projects: SimpleProject[];
}

interface AssetsPageClientProps {
  allWorkspaces: SimpleWorkspace[];
  initialWorkspaceId: string;
  initialProjectId: string | null;
  initialAssets: ProjectAsset[];
}

export function AssetsPageClient({
  allWorkspaces,
  initialWorkspaceId,
  initialProjectId,
  initialAssets,
}: AssetsPageClientProps) {
  const { t } = useI18n();
  const [isPending, startTransition] = useTransition();

  // List view selection state
  const [listWsId, setListWsId] = useState(initialWorkspaceId);
  const [listProjectId, setListProjectId] = useState<string | null>(initialProjectId);

  // Data state
  const [assets, setAssets] = useState<ProjectAsset[]>(initialAssets);

  // Derived
  const listWs = allWorkspaces.find((ws) => ws.id === listWsId);
  const listProjects = listWs?.projects ?? [];

  // Reload assets
  const reloadAssets = useCallback(
    (projectId: string | null) => {
      if (!projectId) {
        setAssets([]);
        return;
      }
      startTransition(async () => {
        const freshAssets = await getProjectAssets(projectId);
        setAssets(freshAssets);
      });
    },
    [startTransition]
  );

  // List view handlers
  const handleListWsChange = (wsId: string) => {
    setListWsId(wsId);
    const ws = allWorkspaces.find((w) => w.id === wsId);
    const firstProject = ws?.projects[0] ?? null;
    setListProjectId(firstProject?.id ?? null);
    reloadAssets(firstProject?.id ?? null);
  };

  const handleListProjectChange = (projectId: string) => {
    setListProjectId(projectId);
    reloadAssets(projectId);
  };

  const handleDelete = async (assetId: string) => {
    const asset = assets.find((a) => a.id === assetId);
    const filename = asset?.filename ?? assetId;
    if (!confirm(t("assets.deleteConfirm", { filename }))) return;
    await deleteAsset(assetId);
    reloadAssets(listProjectId);
  };

  const handleUploaded = () => {
    reloadAssets(listProjectId);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Link
          href={`/workspaces/${listWsId}`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{t("assets.backToBoard")}</span>
        </Link>
        <span className="text-border">·</span>
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span>{t("assets.title")}</span>
        </div>
        {/* Upload button — uses current list project */}
        {listProjectId && (
          <div className="ml-auto">
            <AssetUpload projectId={listProjectId} onUploaded={handleUploaded} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="space-y-4">
          {/* List selectors */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={listWsId}
              onChange={(e) => handleListWsChange(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            >
              {allWorkspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
            {listProjects.length > 0 && (
              <select
                value={listProjectId ?? ""}
                onChange={(e) => handleListProjectChange(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              >
                {listProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.alias ? ` (${p.alias})` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {isPending && (
            <div className="text-xs text-muted-foreground animate-pulse">{t("assets.loading")}</div>
          )}

          {listProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm font-medium text-muted-foreground">{t("assets.noProject")}</p>
              <p className="text-xs text-muted-foreground/60">{t("assets.noProjectHint")}</p>
            </div>
          ) : (
            <AssetList assets={assets} onDelete={handleDelete} />
          )}
        </div>
      </div>
    </div>
  );
}
