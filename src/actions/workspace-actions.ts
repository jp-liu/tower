"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function getWorkspaces() {
  return db.workspace.findMany({
    include: {
      projects: {
        include: {
          tasks: true,
          repositories: true,
        },
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
  const workspace = await db.workspace.create({ data });
  revalidatePath("/workspaces");
  return workspace;
}

export async function updateWorkspace(id: string, data: { name?: string; description?: string }) {
  const workspace = await db.workspace.update({
    where: { id },
    data,
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
  type?: "NORMAL" | "GIT";
  gitUrl?: string;
  localPath?: string;
  workspaceId: string;
}) {
  const project = await db.project.create({
    data: {
      name: data.name,
      alias: data.alias,
      description: data.description,
      type: data.type ?? "NORMAL",
      gitUrl: data.gitUrl,
      localPath: data.localPath,
      workspaceId: data.workspaceId,
    },
  });
  revalidatePath("/workspaces");
  return project;
}

export async function updateProject(id: string, data: { name?: string; alias?: string; description?: string; localPath?: string }) {
  const project = await db.project.update({
    where: { id },
    data,
  });
  revalidatePath("/workspaces");
  return project;
}

export async function deleteProject(id: string) {
  await db.project.delete({ where: { id } });
  revalidatePath("/workspaces");
}
