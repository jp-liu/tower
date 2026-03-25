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

export async function createProject(data: {
  name: string;
  description?: string;
  workspaceId: string;
}) {
  const project = await db.project.create({ data });
  revalidatePath("/workspaces");
  return project;
}
