import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getLabelsForWorkspace } from "@/actions/label-actions";
import { BoardPageClient } from "./board-page-client";

interface Props {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ projectId?: string; taskId?: string }>;
}

export default async function WorkspaceBoardPage({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const { projectId: selectedProjectId, taskId: openTaskId } = await searchParams;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      projects: {
        include: {
          tasks: {
            orderBy: [{ order: "asc" }, { createdAt: "desc" }],
            include: {
              labels: {
                include: { label: true },
              },
              _count: { select: { executions: true } },
            },
          },
          repositories: true,
        },
      },
    },
  });

  if (!workspace) notFound();

  const labels = await getLabelsForWorkspace(workspaceId);

  if (workspace.projects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        <p>该工作空间没有项目，请点击顶部「新建项目」创建</p>
      </div>
    );
  }

  const project = selectedProjectId
    ? workspace.projects.find((p) => p.id === selectedProjectId) ?? workspace.projects[0]
    : workspace.projects[0];

  const tasks = project.tasks;
  const runningTasks = tasks.filter((t) => t.status === "IN_PROGRESS").length;

  return (
    <BoardPageClient
      workspaceId={workspaceId}
      projectId={project.id}
      project={{
        id: project.id,
        name: project.name,
        alias: project.alias,
        description: project.description,
        type: project.type,
        gitUrl: project.gitUrl,
        localPath: project.localPath,
      }}
      projects={workspace.projects.map((p) => ({ id: p.id, name: p.name, alias: p.alias }))}
      initialTasks={tasks}
      totalTasks={tasks.length}
      runningTasks={runningTasks}
      labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color, isBuiltin: l.isBuiltin }))}
      openTaskId={openTaskId}
    />
  );
}
