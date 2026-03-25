"use server";

import { db } from "@/lib/db";

export type SearchCategory = "task" | "project" | "repository";

export interface SearchResult {
  id: string;
  type: SearchCategory;
  title: string;
  subtitle: string;
  navigateTo: string;
}

export async function globalSearch(query: string, category: SearchCategory = "task"): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const q = query.trim();

  if (category === "task") {
    const tasks = await db.task.findMany({
      where: {
        OR: [
          { title: { contains: q } },
          { description: { contains: q } },
        ],
      },
      include: {
        project: {
          include: { workspace: true },
        },
      },
      take: 20,
      orderBy: { updatedAt: "desc" },
    });
    return tasks.map((t) => ({
      id: t.id,
      type: "task" as const,
      title: t.title,
      subtitle: `${t.project.workspace.name} / ${t.project.name}`,
      navigateTo: `/workspaces/${t.project.workspaceId}?projectId=${t.projectId}`,
    }));
  }

  if (category === "project") {
    const projects = await db.project.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { alias: { contains: q } },
          { description: { contains: q } },
        ],
      },
      include: { workspace: true },
      take: 20,
      orderBy: { updatedAt: "desc" },
    });
    return projects.map((p) => ({
      id: p.id,
      type: "project" as const,
      title: p.alias ? `${p.name} (${p.alias})` : p.name,
      subtitle: p.workspace.name,
      navigateTo: `/workspaces/${p.workspaceId}?projectId=${p.id}`,
    }));
  }

  if (category === "repository") {
    const repos = await db.repository.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { path: { contains: q } },
        ],
      },
      include: {
        project: {
          include: { workspace: true },
        },
      },
      take: 20,
    });
    return repos.map((r) => ({
      id: r.id,
      type: "repository" as const,
      title: r.name,
      subtitle: `${r.project.workspace.name} / ${r.project.name} · ${r.branch}`,
      navigateTo: `/workspaces/${r.project.workspaceId}?projectId=${r.projectId}`,
    }));
  }

  return [];
}
