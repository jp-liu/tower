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

  // Selection state — pure client, no router
  const [selectedWsId, setSelectedWsId] = useState(initialWorkspaceId);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProjectId);

  // Data state
  const [assets, setAssets] = useState<ProjectAsset[]>(initialAssets);

  // Derived
  const currentWs = allWorkspaces.find((ws) => ws.id === selectedWsId);
  const projects = currentWs?.projects ?? [];

  // Reload assets for the selected project
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

  // Handlers: workspace / project switch
  const handleWsChange = (wsId: string) => {
    setSelectedWsId(wsId);
    const ws = allWorkspaces.find((w) => w.id === wsId);
    const firstProject = ws?.projects[0] ?? null;
    setSelectedProjectId(firstProject?.id ?? null);
    reloadAssets(firstProject?.id ?? null);
  };

  const handleProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId);
    reloadAssets(projectId);
  };

  const handleDelete = async (assetId: string) => {
    const asset = assets.find((a) => a.id === assetId);
    const filename = asset?.filename ?? assetId;
    if (!confirm(t("assets.deleteConfirm", { filename }))) return;
    await deleteAsset(assetId);
    reloadAssets(selectedProjectId);
  };

  const handleUploaded = () => {
    reloadAssets(selectedProjectId);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Link
          href={`/workspaces/${selectedWsId}`}
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

        {/* Workspace selector */}
        <select
          value={selectedWsId}
          onChange={(e) => handleWsChange(e.target.value)}
          className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        >
          {allWorkspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </select>

        {/* Project selector */}
        {projects.length > 0 && (
          <select
            value={selectedProjectId ?? ""}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.alias ? ` (${p.alias})` : ""}
              </option>
            ))}
          </select>
        )}

        {/* Upload button */}
        {selectedProjectId && (
          <div className="ml-auto">
            <AssetUpload projectId={selectedProjectId} onUploaded={handleUploaded} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {projects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium text-muted-foreground">{t("assets.noProject")}</p>
            <p className="text-xs text-muted-foreground/60">{t("assets.noProjectHint")}</p>
          </div>
        ) : (
          <>
            {isPending && (
              <div className="text-xs text-muted-foreground animate-pulse mb-4">{t("assets.loading")}</div>
            )}
            <AssetList assets={assets} onDelete={handleDelete} />
          </>
        )}
      </div>
    </div>
  );
}
