import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { BoardPageClient } from "./board-page-client";

interface Props {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ projectId?: string }>;
}

export default async function WorkspaceBoardPage({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const { projectId: selectedProjectId } = await searchParams;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      projects: {
        include: {
          tasks: { orderBy: [{ order: "asc" }, { createdAt: "desc" }] },
          repositories: true,
        },
      },
    },
  });

  if (!workspace) notFound();

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
      projectName={project.name}
      projects={workspace.projects.map((p) => ({ id: p.id, name: p.name }))}
      initialTasks={tasks}
      totalTasks={tasks.length}
      runningTasks={runningTasks}
    />
  );
}
