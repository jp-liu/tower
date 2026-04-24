import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { ProjectWorkbenchClient } from "./project-workbench-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ workspaceId: string; projectId: string }>;
}

export default async function ProjectWorkbenchPage({ params }: Props) {
  const { workspaceId, projectId } = await params;

  const [project, workspace] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        alias: true,
        type: true,
        localPath: true,
        gitUrl: true,
        projectType: true,
        previewCommand: true,
        previewPort: true,
        workspaceId: true,
      },
    }),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
  ]);

  if (!project || project.workspaceId !== workspaceId) {
    notFound();
  }

  return (
    <ProjectWorkbenchClient
      project={project}
      workspaceId={workspaceId}
      workspaceName={workspace?.name ?? ""}
    />
  );
}
