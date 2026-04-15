"use server";

import { db } from "@/lib/db";

const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export async function getDailySummary(dateStr?: string) {
  const date = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  date.setHours(0, 0, 0, 0);
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);

  const tasks = await db.task.findMany({
    where: {
      OR: [
        { updatedAt: { gte: date, lt: nextDay } },
        { executions: { some: { startedAt: { gte: date, lt: nextDay } } } },
        { messages: { some: { createdAt: { gte: date, lt: nextDay } } } },
      ],
    },
    include: {
      project: { include: { workspace: true } },
      messages: {
        where: { role: "ASSISTANT", createdAt: { gte: date, lt: nextDay } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true },
      },
      executions: {
        where: { startedAt: { gte: date, lt: nextDay } },
        orderBy: { startedAt: "desc" },
        take: 1,
        select: { startedAt: true, status: true, summary: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  type CompletedTask = { id: string; title: string; priority: string; completedAt: string };
  type InProgressTask = { id: string; title: string; status: string; priority: string; lastActivity: string; progressSummary: string | null };

  const wsMap = new Map<string, { id: string; name: string; projects: Map<string, { id: string; name: string; alias: string | null; completed: CompletedTask[]; inProgress: InProgressTask[] }> }>();

  for (const task of tasks) {
    const ws = task.project.workspace;
    if (!wsMap.has(ws.id)) wsMap.set(ws.id, { id: ws.id, name: ws.name, projects: new Map() });
    const projMap = wsMap.get(ws.id)!.projects;
    const proj = task.project;
    if (!projMap.has(proj.id)) projMap.set(proj.id, { id: proj.id, name: proj.name, alias: proj.alias, completed: [], inProgress: [] });
    const projEntry = projMap.get(proj.id)!;

    if (task.status === "DONE") {
      projEntry.completed.push({ id: task.id, title: task.title, priority: task.priority, completedAt: task.updatedAt.toISOString() });
    } else if (task.status !== "CANCELLED") {
      projEntry.inProgress.push({
        id: task.id, title: task.title, status: task.status, priority: task.priority,
        lastActivity: (task.messages[0]?.createdAt ?? task.updatedAt).toISOString(),
        progressSummary: task.executions[0]?.summary
          ?? (task.messages[0]?.content ? task.messages[0].content.slice(0, 200) + (task.messages[0].content.length > 200 ? "..." : "") : null),
      });
    }
  }

  let totalCompleted = 0;
  let totalInProgress = 0;
  const workspaces = Array.from(wsMap.values()).map((ws) => ({
    id: ws.id, name: ws.name,
    projects: Array.from(ws.projects.values()).map((p) => {
      totalCompleted += p.completed.length;
      totalInProgress += p.inProgress.length;
      return { id: p.id, name: p.name, alias: p.alias, completed: p.completed, inProgress: p.inProgress };
    }),
  }));

  return { date: date.toISOString().slice(0, 10), workspaces, stats: { totalCompleted, totalInProgress, totalActive: totalCompleted + totalInProgress } };
}

export async function getDailyTodo(filters?: {
  workspaceId?: string;
  projectId?: string;
  status?: ("TODO" | "IN_PROGRESS" | "IN_REVIEW")[];
  priority?: ("LOW" | "MEDIUM" | "HIGH" | "CRITICAL")[];
}) {
  const statusFilter = filters?.status ?? ["TODO", "IN_PROGRESS", "IN_REVIEW"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { status: { in: statusFilter } };
  if (filters?.priority) where.priority = { in: filters.priority };
  if (filters?.projectId) where.projectId = filters.projectId;
  if (filters?.workspaceId) where.project = { workspaceId: filters.workspaceId };

  const tasks = await db.task.findMany({
    where,
    include: {
      project: { include: { workspace: true } },
      labels: { include: { label: true } },
      executions: {
        where: { sessionId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { sessionId: true },
      },
    },
  });

  // Sort by priority severity (CRITICAL first), then updatedAt desc
  tasks.sort((a, b) =>
    (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99)
    || b.updatedAt.getTime() - a.updatedAt.getTime()
  );

  const wsMap = new Map<string, { id: string; name: string; projects: Map<string, { id: string; name: string; alias: string | null; tasks: { id: string; title: string; status: string; priority: string; labels: string[]; createdAt: string; lastSessionId: string | null }[] }> }>();

  for (const task of tasks) {
    const ws = task.project.workspace;
    if (!wsMap.has(ws.id)) wsMap.set(ws.id, { id: ws.id, name: ws.name, projects: new Map() });
    const projMap = wsMap.get(ws.id)!.projects;
    const proj = task.project;
    if (!projMap.has(proj.id)) projMap.set(proj.id, { id: proj.id, name: proj.name, alias: proj.alias, tasks: [] });
    projMap.get(proj.id)!.tasks.push({
      id: task.id, title: task.title, status: task.status, priority: task.priority,
      labels: task.labels.map((tl) => tl.label.name),
      createdAt: task.createdAt.toISOString(), lastSessionId: task.executions[0]?.sessionId ?? null,
    });
  }

  const byStatus = { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0 };
  const byPriority = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const t of tasks) {
    if (t.status in byStatus) byStatus[t.status as keyof typeof byStatus]++;
    if (t.priority in byPriority) byPriority[t.priority as keyof typeof byPriority]++;
  }

  return {
    date: new Date().toISOString().slice(0, 10),
    workspaces: Array.from(wsMap.values()).map((ws) => ({
      id: ws.id, name: ws.name,
      projects: Array.from(ws.projects.values()).map((p) => ({ id: p.id, name: p.name, alias: p.alias, tasks: p.tasks })),
    })),
    stats: { total: tasks.length, byStatus, byPriority },
  };
}
