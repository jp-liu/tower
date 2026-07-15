"use server";

import { mkdir } from "fs/promises";
import { readdir } from "node:fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { createWorkspaceSchema, updateWorkspaceSchema, reorderWorkspacesSchema, createProjectSchema, updateProjectSchema } from "@/lib/schemas";
import { expandHome } from "@/lib/git-url";
import { syncProjectDoc } from "@/lib/group-doc";
import { detectPreset } from "@/lib/preview/detector";

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

/**
 * Persist a new sidebar ordering for workspaces.
 * `orderedIds` is the full list of workspace ids in their desired top-to-bottom order.
 * Each workspace's `order` is set to its index. Validates that every id refers to an
 * existing workspace and that the list matches the full set (no missing/extra ids).
 */
export async function reorderWorkspaces(orderedIds: string[]) {
  const ids = reorderWorkspacesSchema.parse(orderedIds);

  // Reject duplicate ids in the payload.
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate workspace ids in reorder request");
  }

  // Validate against existing workspaces — the payload must be the complete set.
  const existing = await db.workspace.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((w) => w.id));
  for (const id of ids) {
    if (!existingIds.has(id)) {
      throw new Error("Unknown workspace id in reorder request");
    }
  }
  if (ids.length !== existingIds.size) {
    throw new Error("Reorder request must include every workspace");
  }

  // Persist atomically: each workspace's order = its index in the list.
  await db.$transaction(
    ids.map((id, index) =>
      db.workspace.update({ where: { id }, data: { order: index } })
    )
  );

  revalidatePath("/workspaces");
}

export async function deleteWorkspace(id: string) {
  const count = await db.workspace.count();
  if (count <= 1) {
    throw new Error("Cannot delete the last workspace");
  }
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
  const resolvedLocalPath = v.localPath ? expandHome(v.localPath) : undefined;

  // Ensure target folder exists for non-git projects (git clone creates it automatically).
  // Without this, downstream features (terminal, file tree) fail with ENOENT.
  if (resolvedLocalPath && !v.gitUrl && path.isAbsolute(resolvedLocalPath)) {
    try {
      await mkdir(resolvedLocalPath, { recursive: true });
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      throw new Error(`无法创建项目目录 ${resolvedLocalPath}: ${error.message}`);
    }
  }

  const project = await db.project.create({
    data: {
      name: v.name,
      alias: v.alias,
      description: v.description,
      type: v.gitUrl ? "GIT" : "NORMAL",
      gitUrl: v.gitUrl || undefined,
      localPath: resolvedLocalPath,
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

  // T1: 探测 preset（仅当 localPath 非空时）
  if (resolvedLocalPath) {
    try {
      const entries = await readdir(resolvedLocalPath).catch(() => [] as string[]);
      if (entries.length > 0) {
        const detected = await detectPreset(resolvedLocalPath);
        if (detected) {
          await db.project.update({
            where: { id: project.id },
            data: { previewPreset: detected.id },
          });
        }
      }
    } catch {
      // 探测失败不阻塞创建
    }
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

  // T1: 如果 localPath 变了，重新探测 preset
  if (data.localPath !== undefined) {
    const resolved = data.localPath ? expandHome(data.localPath) : null;
    if (resolved) {
      try {
        const entries = await readdir(resolved).catch(() => [] as string[]);
        if (entries.length > 0) {
          const detected = await detectPreset(resolved);
          await db.project.update({
            where: { id },
            data: { previewPreset: detected?.id ?? null },
          });
        }
      } catch {
        // 失败不阻塞 update
      }
    }
    // The group block lists every member's absolute path — a moved repo
    // invalidates its siblings' blocks too, so re-render the whole group.
    await syncProjectDoc(db, id);
  }

  revalidatePath("/workspaces");
  return project;
}

export async function deleteProject(id: string) {
  // Graceful cleanup: stop active executions, cancel pending tasks, remove worktrees
  const tasks = await db.task.findMany({
    where: { projectId: id },
    include: { project: { select: { localPath: true } } },
  });

  const { destroySession } = await import("@/lib/pty/session-store");
  const { removeWorktree } = await import("@/lib/worktree");
  const { getRecordedWorktreeBranch } = await import("@/lib/task-completion");

  for (const task of tasks) {
    // Kill any running PTY session
    try { destroySession(task.id); } catch { /* best-effort */ }

    // Cancel running executions
    await db.taskExecution.updateMany({
      where: { taskId: task.id, status: { in: ["PENDING", "RUNNING", "PAUSED"] } },
      data: { status: "FAILED", endedAt: new Date() },
    });

    // Clean up worktree
    if (task.project?.localPath) {
      try {
        await removeWorktree(
          task.project.localPath,
          task.id,
          await getRecordedWorktreeBranch(task.id)
        );
      } catch { /* best-effort */ }
    }

    // Set non-terminal tasks to CANCELLED
    if (!["DONE", "CANCELLED"].includes(task.status)) {
      await db.task.update({
        where: { id: task.id },
        data: { status: "CANCELLED" },
      });
    }
  }

  // Now safe to delete (cascade handles remaining DB records)
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
            where: {
              status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] },
              // Exclude system tasks tagged with the builtin "Tower" label
              NOT: { labels: { some: { label: { name: "Tower", isBuiltin: true } } } },
            },
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
                where: {
                  status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] },
                  NOT: { labels: { some: { label: { name: "Tower", isBuiltin: true } } } },
                },
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

/**
 * Like getWorkspacesWithRecentTasks but returns ALL active (TODO/IN_PROGRESS/IN_REVIEW)
 * tasks per project — no per-project limit. Used by the Missions task picker dialog,
 * which paginates and searches client-side. The dataset is bounded (completed/cancelled
 * tasks are excluded), so a single fetch is cheap.
 */
export async function getWorkspacesWithActiveTasks() {
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
            where: {
              // Active tasks OR the project's Tower workbench task (always
              // launchable, regardless of its status). The dialog pins the
              // workbench separately and lists the rest as regular tasks.
              OR: [
                { status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] } },
                { labels: { some: { label: { name: "Tower", isBuiltin: true } } } },
              ],
            },
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              // Non-empty only for the Tower workbench task — lets the client
              // tell the workbench apart from regular tasks without extra payload.
              labels: {
                where: { label: { name: "Tower", isBuiltin: true } },
                select: { labelId: true },
              },
              executions: {
                where: { sessionId: { not: null } },
                select: { sessionId: true },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
            orderBy: { updatedAt: "desc" },
          },
          _count: {
            select: {
              // Regular (non-workbench) active task count for the sidebar badge.
              tasks: {
                where: {
                  status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] },
                  NOT: { labels: { some: { label: { name: "Tower", isBuiltin: true } } } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    // Match the sidebar's ordering (layout.tsx): honor the manual drag-reorder
    // `order` field first, falling back to most-recently-updated. Keeps the
    // task picker's workspace list consistent with the sidebar.
    orderBy: [{ order: "asc" }, { updatedAt: "desc" }],
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

/**
 * Get or create the Tower task for a project (for Open Studio).
 * Returns the taskId directly so the client can navigate without a server-side redirect.
 */
export async function getOrCreateTowerTaskId(projectId: string): Promise<string> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("Project not found");

  const { ensureTowerTask } = await import("@/lib/instrumentation-tasks");
  return ensureTowerTask(project.id, project.name);
}
