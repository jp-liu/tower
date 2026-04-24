"use client";

import { useState, useTransition, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { SubPageNav } from "@/components/layout/sub-page-nav";
import { useI18n } from "@/lib/i18n";
import { deleteAsset, getProjectAssets } from "@/actions/asset-actions";
import type { ProjectAssetWithTask } from "@/actions/asset-actions";
import { AssetList } from "@/components/assets/asset-list";
import { AssetUpload } from "@/components/assets/asset-upload";
import { ImageLightbox } from "@/components/assets/image-lightbox";
import { TextPreviewDialog } from "@/components/assets/text-preview-dialog";
import { TaskOverviewDrawer } from "@/components/task/task-overview-drawer";
import { localPathToApiUrl } from "@/lib/file-serve-client";
import { toast } from "sonner";
import type { AssetItemType } from "@/components/assets/asset-item";
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
  initialAssets: ProjectAssetWithTask[];
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
  const [assets, setAssets] = useState<ProjectAssetWithTask[]>(initialAssets);

  // Task drawer state
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);

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

  // Preview modal state
  const [previewAsset, setPreviewAsset] = useState<AssetItemType | null>(null);

  const previewType = previewAsset
    ? previewAsset.mimeType?.startsWith("image/")
      ? "image"
      : /\.(txt|md|json)$/i.test(previewAsset.filename)
        ? "text"
        : null
    : null;

  const handlePreview = (asset: AssetItemType) => {
    const isImage = asset.mimeType?.startsWith("image/");
    const isText = /\.(txt|md|json)$/i.test(asset.filename);
    if (isImage || isText) {
      setPreviewAsset(asset);
    }
  };

  const handleReveal = async (asset: AssetItemType) => {
    try {
      const res = await fetch("/api/internal/assets/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: asset.path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to reveal file");
      }
    } catch {
      toast.error("Failed to reveal file");
    }
  };

  // List view handlers
  const handleListWsChange = (wsId: string) => {
    if (wsId === listWsId) return;
    setListWsId(wsId);
    const ws = allWorkspaces.find((w) => w.id === wsId);
    const firstProject = ws?.projects[0] ?? null;
    setListProjectId(firstProject?.id ?? null);
    reloadAssets(firstProject?.id ?? null);
  };

  const handleListProjectChange = (projectId: string) => {
    if (projectId === listProjectId) return;
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
      <SubPageNav workspaceId={listWsId} />

      {/* Action bar */}
      <div className="header-sm flex items-center gap-3 px-6 py-2">
        <Select value={listWsId} onValueChange={(v) => v && handleListWsChange(v)}>
          <SelectTrigger className="h-8 w-auto min-w-[120px]">
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
            <SelectTrigger className="h-8 w-auto min-w-[140px]">
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
        <div className={`relative ${isPending ? "opacity-40 pointer-events-none" : ""} transition-opacity`}>
            {isPending && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {listProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <p className="text-sm font-medium text-muted-foreground">{t("assets.noProject")}</p>
                <p className="text-xs text-muted-foreground/60">{t("assets.noProjectHint")}</p>
              </div>
            ) : (
              <AssetList
                assets={assets.map((a) => ({
                  ...a,
                  taskId: a.task?.id ?? null,
                  taskTitle: a.task?.title ?? null,
                }))}
                onPreview={handlePreview}
                onReveal={handleReveal}
                onDelete={handleDelete}
                onTaskClick={setDrawerTaskId}
              />
            )}
          </div>
      </div>

      <ImageLightbox
        imageUrl={previewType === "image" && previewAsset ? localPathToApiUrl(previewAsset.path) : null}
        filename={previewAsset?.filename ?? ""}
        open={previewType === "image"}
        onOpenChange={(open) => { if (!open) setPreviewAsset(null); }}
      />
      <TextPreviewDialog
        url={previewType === "text" && previewAsset ? localPathToApiUrl(previewAsset.path) : null}
        filename={previewAsset?.filename ?? ""}
        open={previewType === "text"}
        onOpenChange={(open) => { if (!open) setPreviewAsset(null); }}
      />
      <TaskOverviewDrawer
        open={!!drawerTaskId}
        onOpenChange={(o) => { if (!o) setDrawerTaskId(null); }}
        taskId={drawerTaskId}
      />
    </div>
  );
}
