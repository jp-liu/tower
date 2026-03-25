"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function sendTaskMessage(taskId: string, content: string) {
  const userMessage = await db.taskMessage.create({
    data: {
      role: "USER",
      content,
      taskId,
    },
  });

  // For now, create a mock assistant response
  // TODO: In the future, this will trigger the AI agent via the AgentRunner
  const assistantMessage = await db.taskMessage.create({
    data: {
      role: "ASSISTANT",
      content: `收到消息: "${content}"\n\n正在分析任务... (AI 代理集成开发中)`,
      taskId,
    },
  });

  revalidatePath("/workspaces");
  return { userMessage, assistantMessage };
}

export async function getTaskMessages(taskId: string) {
  return db.taskMessage.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
  });
}

export async function startTaskExecution(
  taskId: string,
  agent: string = "CLAUDE_CODE"
) {
  const execution = await db.taskExecution.create({
    data: {
      taskId,
      agent,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  await db.task.update({
    where: { id: taskId },
    data: { status: "IN_PROGRESS" },
  });

  revalidatePath("/workspaces");
  return execution;
}

export async function stopTaskExecution(executionId: string) {
  const execution = await db.taskExecution.update({
    where: { id: executionId },
    data: { status: "COMPLETED", endedAt: new Date() },
  });
  revalidatePath("/workspaces");
  return execution;
}

export async function getTaskExecutions(taskId: string) {
  return db.taskExecution.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
  });
}
