import { db } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { ensureTowerTask } from "@/lib/instrumentation-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ workspaceId: string; projectId: string }>;
}

/**
 * Project Workbench — finds or creates the Tower task (by label, not title)
 * and redirects to the task detail page.
 */
export default async function ProjectWorkbenchPage({ params }: Props) {
  const { workspaceId, projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, workspaceId: true },
  });

  if (!project || project.workspaceId !== workspaceId) {
    notFound();
  }

  const taskId = await ensureTowerTask(project.id, project.name);
  redirect(`/workspaces/${workspaceId}/tasks/${taskId}`);
}
