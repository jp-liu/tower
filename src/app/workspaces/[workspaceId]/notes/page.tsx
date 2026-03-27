import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProjectNotes } from "@/actions/note-actions";
import { NotesPageClient } from "./notes-page-client";

interface Props {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ projectId?: string }>;
}

export default async function NotesPage({ params, searchParams }: Props) {
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
      <NotesPageClient
        workspaceId={workspaceId}
        project={undefined}
        projects={[]}
        initialNotes={[]}
      />
    );
  }

  const project = selectedProjectId
    ? workspace.projects.find((p) => p.id === selectedProjectId) ?? workspace.projects[0]
    : workspace.projects[0];

  const notes = project ? await getProjectNotes(project.id) : [];

  return (
    <NotesPageClient
      workspaceId={workspaceId}
      project={project}
      projects={workspace.projects}
      initialNotes={notes}
    />
  );
}
