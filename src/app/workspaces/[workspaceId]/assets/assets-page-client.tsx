"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, FolderOpen } from "lucide-react";
import type { ProjectAsset } from "@prisma/client";
import { useI18n } from "@/lib/i18n";
import { deleteAsset, getProjectAssets } from "@/actions/asset-actions";
import { AssetList } from "@/components/assets/asset-list";
import { AssetUpload } from "@/components/assets/asset-upload";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

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

  const handleUploaded = (uploadedToProjectId: string) => {
    // Refresh list if we uploaded to the project currently being viewed
    if (uploadedToProjectId === listProjectId) {
      reloadAssets(listProjectId);
    }
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
        <div className="ml-auto">
          <AssetUpload
            allWorkspaces={allWorkspaces}
            initialWsId={listWsId}
            initialProjectId={listProjectId}
            onUploaded={handleUploaded}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="space-y-4">
          {/* List selectors */}
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={listWsId} onValueChange={(v) => v && handleListWsChange(v)}>
              <SelectTrigger size="sm" className="min-w-[140px] text-xs">
                <span className="truncate">{allWorkspaces.find((ws) => ws.id === listWsId)?.name ?? listWsId}</span>
              </SelectTrigger>
              <SelectContent>
                {allWorkspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {listProjects.length > 0 && (
              <Select value={listProjectId ?? ""} onValueChange={(v) => v && handleListProjectChange(v)}>
                <SelectTrigger size="sm" className="min-w-[160px] text-xs">
                  <span className="truncate">
                    {(() => { const p = listProjects.find((x) => x.id === listProjectId); return p ? (p.alias ? `${p.name} (${p.alias})` : p.name) : ""; })()}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {listProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}{p.alias ? ` (${p.alias})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
