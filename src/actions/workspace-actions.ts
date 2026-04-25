"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { createWorkspaceSchema, updateWorkspaceSchema, createProjectSchema, updateProjectSchema } from "@/lib/schemas";
import { expandHome } from "@/lib/git-url";

/** Lightweight list: workspace names + project names only (for selectors) */
export async function getWorkspacesWithProjects() {
  return db.workspace.findMany({
    select: {
      id: true,
      name: true,
      projects: {
        select: { id: true, name: true, alias: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getWorkspaceById(id: string) {
  return db.workspace.findUnique({
    where: { id },
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
}

export async function createWorkspace(data: { name: string; description?: string }) {
  const v = createWorkspaceSchema.parse(data);
  const workspace = await db.workspace.create({ data: v });
  revalidatePath("/workspaces");
  return workspace;
}

export async function updateWorkspace(id: string, data: { name?: string; description?: string }) {
  const v = updateWorkspaceSchema.parse(data);
  const workspace = await db.workspace.update({
    where: { id },
    data: v,
  });
  revalidatePath("/workspaces");
  return workspace;
}

export async function deleteWorkspace(id: string) {
  await db.workspace.delete({ where: { id } });
  revalidatePath("/workspaces");
}

export async function createProject(data: {
  name: string;
  alias?: string;
  description?: string;
  gitUrl?: string;
  localPath?: string;
  workspaceId: string;
  projectType?: "FRONTEND" | "BACKEND";
  previewCommand?: string | null;
}) {
  const v = createProjectSchema.parse(data);
  const project = await db.project.create({
    data: {
      name: v.name,
      alias: v.alias,
      description: v.description,
      type: v.gitUrl ? "GIT" : "NORMAL",
      gitUrl: v.gitUrl || undefined,
      localPath: v.localPath ? expandHome(v.localPath) : undefined,
      projectType: v.projectType,
      previewCommand: v.previewCommand,
      workspaceId: v.workspaceId,
    },
  });

  // Auto-create Tower task (project workbench)
  try {
    const { ensureTowerTask } = await import("@/lib/instrumentation-tasks");
    await ensureTowerTask(project.id, v.name);
  } catch (error) {
    console.warn("Failed to auto-create Tower task", error);
  }

  revalidatePath("/workspaces");
  return project;
}

export async function updateProject(id: string, data: { name?: string; alias?: string; description?: string; localPath?: string; projectType?: "FRONTEND" | "BACKEND"; previewCommand?: string | null; previewPort?: number | null }) {
  const v = updateProjectSchema.parse(data);
  const updateData = { ...v };
  if (updateData.localPath) updateData.localPath = expandHome(updateData.localPath);
  const project = await db.project.update({
    where: { id },
    data: updateData,
  });
  revalidatePath("/workspaces");
  return project;
}

export async function deleteProject(id: string) {
  await db.project.delete({ where: { id } });
  revalidatePath("/workspaces");
}

export async function getProjectByLocalPath(localPath: string) {
  return db.project.findFirst({
    where: { localPath },
    include: { workspace: true },
  });
}

export async function getWorkspacesWithRecentTasks(limit = 3) {
  return db.workspace.findMany({
    select: {
      id: true,
      name: true,
      projects: {
        select: {
          id: true,
          name: true,
          alias: true,
          tasks: {
            where: { status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] } },
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              executions: {
                where: { sessionId: { not: null } },
                select: { sessionId: true },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
            orderBy: { updatedAt: "desc" },
            take: limit,
          },
          _count: {
            select: {
              tasks: {
                where: { status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] } },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getRecentLocalProjects(limit = 10) {
  return db.project.findMany({
    where: { localPath: { not: null } },
    select: { id: true, name: true, alias: true, localPath: true, workspaceId: true, type: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}
