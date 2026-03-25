import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { BoardPageClient } from "./board-page-client";

interface Props {
  params: Promise<{ workspaceId: string }>;
}

export default async function WorkspaceBoardPage({ params }: Props) {
  const { workspaceId } = await params;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      projects: {
        include: {
          tasks: {
            orderBy: [{ order: "asc" }, { createdAt: "desc" }],
          },
          repositories: true,
        },
      },
    },
  });

  if (!workspace) {
    notFound();
  }

  const project = workspace.projects[0];
  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        <p>该工作空间没有项目，请先创建一个项目</p>
      </div>
    );
  }

  const tasks = project.tasks;
  const runningTasks = tasks.filter(
    (t) => t.status === "IN_PROGRESS"
  ).length;

  return (
    <BoardPageClient
      workspaceId={workspaceId}
      projectId={project.id}
      projectName={project.name}
      initialTasks={tasks}
      totalTasks={tasks.length}
      runningTasks={runningTasks}
    />
  );
}
