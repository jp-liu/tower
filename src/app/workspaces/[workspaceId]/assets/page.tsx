import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProjectAssets } from "@/actions/asset-actions";
import { getWorkspacesWithProjects } from "@/actions/workspace-actions";
import { AssetsPageClient } from "./assets-page-client";

interface Props {
  params: Promise<{ workspaceId: string }>;
}

export default async function AssetsPage({ params }: Props) {
  const { workspaceId } = await params;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) notFound();

  const allWorkspaces = await getWorkspacesWithProjects();

  const currentWs = allWorkspaces.find((ws) => ws.id === workspaceId);
  const initialProject = currentWs?.projects[0];
  const initialAssets = initialProject
    ? await getProjectAssets(initialProject.id)
    : [];

  return (
    <AssetsPageClient
      allWorkspaces={allWorkspaces}
      initialWorkspaceId={workspaceId}
      initialProjectId={initialProject?.id ?? null}
      initialAssets={initialAssets}
    />
  );
}
