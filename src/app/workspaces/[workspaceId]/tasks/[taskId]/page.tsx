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
    subPath: task.subPath,
    projectId: task.projectId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    project: task.project
      ? {
          id: task.project.id,
          name: task.project.name,
          type: task.project.type,
          localPath: task.project.localPath,
          projectType: task.project.projectType,
          previewCommand: task.project.previewCommand,
          previewPort: task.project.previewPort,
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

  const [task, workspace] = await Promise.all([
    fetchTask(taskId),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
  ]);

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

  // Serialize all executions for the timeline (Date → string)
  const serializedExecutions = (executions as Record<string, unknown>[])
    .filter((e) => e.status !== "RUNNING")
    .map((e) => ({
      id: e.id as string,
      status: e.status as string,
      sessionId: (e.sessionId as string) ?? null,
      summary: (e.summary as string) ?? null,
      gitLog: (e.gitLog as string) ?? null,
      gitStats: (e.gitStats as string) ?? null,
      exitCode: (e.exitCode as number) ?? null,
      terminalLog: (e.terminalLog as string) ?? null,
      startedAt: e.startedAt instanceof Date ? e.startedAt.toISOString() : null,
      endedAt: e.endedAt instanceof Date ? e.endedAt.toISOString() : null,
    }));

  return (
    <TaskPageClient
      task={serialized}
      workspaceId={workspaceId}
      workspaceName={workspace?.name ?? ""}
      latestExecution={serializedExecution}
      executions={serializedExecutions}
    />
  );
}
