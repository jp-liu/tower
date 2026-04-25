import { db } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { TOWER_LABEL_NAME } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ workspaceId: string; projectId: string }>;
}

/**
 * Project Workbench — finds the "{name}-Tower" task (auto-created with project)
 * and redirects to the task detail page. Falls back to creating one if missing.
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

  const towerTitle = `${project.name}-Tower`;

  // Find existing Tower task
  let task = await db.task.findFirst({
    where: { projectId: project.id, title: towerTitle },
    select: { id: true },
  });

  // Fallback: create if missing (e.g. project created before this feature)
  if (!task) {
    const towerLabel = await db.label.findFirst({
      where: { name: TOWER_LABEL_NAME, isBuiltin: true },
    });

    task = await db.task.create({
      data: {
        title: towerTitle,
        description: `Project workbench for ${project.name}`,
        projectId: project.id,
        status: "TODO",
        priority: "LOW",
        order: 0,
        ...(towerLabel ? { labels: { create: { labelId: towerLabel.id } } } : {}),
      },
      select: { id: true },
    });
  }

  redirect(`/workspaces/${workspaceId}/tasks/${task.id}`);
}
