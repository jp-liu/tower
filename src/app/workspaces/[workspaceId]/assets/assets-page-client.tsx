"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FolderOpen } from "lucide-react";
import type { ProjectAsset } from "@prisma/client";
import { useI18n } from "@/lib/i18n";
import { deleteAsset } from "@/actions/asset-actions";
import { AssetList } from "@/components/assets/asset-list";
import { AssetUpload } from "@/components/assets/asset-upload";

interface Project {
  id: string;
  name: string;
  alias: string | null;
}

interface AssetsPageClientProps {
  workspaceId: string;
  project?: Project;
  projects: Project[];
  initialAssets: ProjectAsset[];
}

export function AssetsPageClient({
  workspaceId,
  project,
  projects,
  initialAssets,
}: AssetsPageClientProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const handleDelete = async (assetId: string) => {
    const asset = initialAssets.find((a) => a.id === assetId);
    const filename = asset?.filename ?? assetId;
    if (!confirm(t("assets.deleteConfirm", { filename }))) return;
    await deleteAsset(assetId);
    startTransition(() => router.refresh());
  };

  const handleUploaded = () => {
    startTransition(() => router.refresh());
  };

  const handleProjectChange = (newProjectId: string) => {
    router.push(`/workspaces/${workspaceId}/assets?projectId=${newProjectId}`);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>返回看板</span>
        </Link>
        <span className="text-border">·</span>
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span>{t("assets.title")}</span>
        </div>

        {/* Project selector */}
        {projects.length > 1 && (
          <select
            value={project?.id ?? ""}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.alias ? ` (${p.alias})` : ""}
              </option>
            ))}
          </select>
        )}

        {/* Upload button */}
        {project && (
          <div className="ml-auto">
            <AssetUpload projectId={project.id} onUploaded={handleUploaded} />
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
          <AssetList assets={initialAssets} onDelete={handleDelete} />
        )}
      </div>
    </div>
  );
}
