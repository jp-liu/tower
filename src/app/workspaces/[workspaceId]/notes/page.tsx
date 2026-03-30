import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProjectNotes } from "@/actions/note-actions";
import { getWorkspacesWithProjects } from "@/actions/workspace-actions";
import { NotesPageClient } from "./notes-page-client";

interface Props {
  params: Promise<{ workspaceId: string }>;
}

export default async function NotesPage({ params }: Props) {
  const { workspaceId } = await params;

  // Verify current workspace exists
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) notFound();

  // All workspaces with their projects (lightweight) for the selector
  const allWorkspaces = await getWorkspacesWithProjects();

  // Find current workspace's projects for initial data
  const currentWs = allWorkspaces.find((ws) => ws.id === workspaceId);
  const initialProject = currentWs?.projects[0];
  const initialNotes = initialProject
    ? await getProjectNotes(initialProject.id)
    : [];

  return (
    <NotesPageClient
      allWorkspaces={allWorkspaces}
      initialWorkspaceId={workspaceId}
      initialProjectId={initialProject?.id ?? null}
      initialNotes={initialNotes}
    />
  );
}
