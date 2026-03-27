import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProjectAssets } from "@/actions/asset-actions";
import { AssetsPageClient } from "./assets-page-client";

interface Props {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ projectId?: string }>;
}

export default async function AssetsPage({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const { projectId: selectedProjectId } = await searchParams;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      projects: {
        select: { id: true, name: true, alias: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!workspace) notFound();

  if (workspace.projects.length === 0) {
    return (
      <AssetsPageClient
        workspaceId={workspaceId}
        project={undefined}
        projects={[]}
        initialAssets={[]}
      />
    );
  }

  const project = selectedProjectId
    ? workspace.projects.find((p) => p.id === selectedProjectId) ?? workspace.projects[0]
    : workspace.projects[0];

  const assets = project ? await getProjectAssets(project.id) : [];

  return (
    <AssetsPageClient
      workspaceId={workspaceId}
      project={project}
      projects={workspace.projects}
      initialAssets={assets}
    />
  );
}
