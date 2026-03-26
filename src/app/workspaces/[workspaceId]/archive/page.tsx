import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getArchivedTasks } from "@/actions/task-actions";
import { ArchivePageClient } from "./archive-page-client";

interface Props {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ projectId?: string }>;
}

export default async function ArchivePage({ params, searchParams }: Props) {
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
      <ArchivePageClient
        workspaceId={workspaceId}
        projects={[]}
        activeProjectId=""
        archivedTasks={[]}
      />
    );
  }

  const project = selectedProjectId
    ? workspace.projects.find((p) => p.id === selectedProjectId) ?? workspace.projects[0]
    : workspace.projects[0];

  const archivedTasks = await getArchivedTasks(project.id);

  return (
    <ArchivePageClient
      workspaceId={workspaceId}
      projects={workspace.projects}
      activeProjectId={project.id}
      archivedTasks={archivedTasks}
    />
  );
}
