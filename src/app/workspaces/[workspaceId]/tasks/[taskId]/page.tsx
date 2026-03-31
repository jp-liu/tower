import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { TaskPageClient } from "./task-page-client";
import { getTaskExecutions } from "@/actions/agent-actions";

interface Props {
  params: Promise<{ workspaceId: string; taskId: string }>;
}

function serializeTask(task: Awaited<ReturnType<typeof fetchTask>>) {
  if (!task) return null;
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    baseBranch: task.baseBranch,
    projectId: task.projectId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    project: task.project
      ? {
          id: task.project.id,
          name: task.project.name,
          type: task.project.type,
          localPath: task.project.localPath,
        }
      : null,
  };
}

async function fetchTask(taskId: string) {
  return db.task.findUnique({
    where: { id: taskId },
    include: {
      project: true,
      labels: { include: { label: true } },
    },
  });
}

export default async function TaskPage({ params }: Props) {
  const { workspaceId, taskId } = await params;

  const task = await fetchTask(taskId);

  if (!task || task.project?.workspaceId !== workspaceId) {
    notFound();
  }

  const serialized = serializeTask(task);
  if (!serialized) notFound();

  const executions = await getTaskExecutions(taskId);
  const latestExecution = executions[0] ?? null;
  const serializedExecution = latestExecution
    ? {
        worktreePath: latestExecution.worktreePath,
        worktreeBranch: latestExecution.worktreeBranch,
        status: latestExecution.status,
      }
    : null;

  return (
    <TaskPageClient
      task={serialized}
      workspaceId={workspaceId}
      latestExecution={serializedExecution}
    />
  );
}
