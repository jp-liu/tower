import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getArchivedTasks } from "@/actions/task-actions";
import { getWorkspacesWithProjects } from "@/actions/workspace-actions";
import { ArchivePageClient } from "./archive-page-client";

interface Props {
  params: Promise<{ workspaceId: string }>;
}

export default async function ArchivePage({ params }: Props) {
  const { workspaceId } = await params;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) notFound();

  const allWorkspaces = await getWorkspacesWithProjects();

  const currentWs = allWorkspaces.find((ws) => ws.id === workspaceId);
  const initialProject = currentWs?.projects[0];
  const initialTasks = initialProject
    ? await getArchivedTasks(initialProject.id)
    : [];

  return (
    <ArchivePageClient
      allWorkspaces={allWorkspaces}
      initialWorkspaceId={workspaceId}
      initialProjectId={initialProject?.id ?? null}
      initialTasks={initialTasks}
    />
  );
}
