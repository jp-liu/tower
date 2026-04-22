import { z } from "zod";
import { execFileSync } from "child_process";
import { copyFileSync, existsSync, statSync, mkdirSync } from "fs";
import { basename, extname, join, resolve } from "path";
import { db } from "../db";
import { stripCacheUuidSuffix, isAssistantCachePath } from "@/lib/file-utils";

// Derive project root from this file's location (src/mcp/tools/ → ../../..)
// This avoids depending on process.cwd() which varies when MCP is spawned from .tower/
const MCP_PROJECT_ROOT = resolve(__dirname, "../../..");

const TaskStatus = z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]);
const Priority = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const taskTools = {
  list_tasks: {
    description: "List all tasks in a project, optionally filtered by status. Includes labels and is ordered by position then creation date.",
    schema: z.object({
      projectId: z.string(),
      status: TaskStatus.optional(),
    }),
    handler: async (args: { projectId: string; status?: string }) => {
      const tasks = await db.task.findMany({
        where: {
          projectId: args.projectId,
          ...(args.status ? { status: args.status as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED" } : {}),
        },
        include: {
          labels: { include: { label: true } },
        },
        orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      });

      return tasks.map((task) => ({
        ...task,
        labels: task.labels.map((tl) => tl.label),
      }));
    },
  },

  create_task: {
    description: "Create a new task in a project. Priority defaults to MEDIUM, status defaults to TODO. Set useWorktree=true for branch isolation. Set autoStart=true (default) to immediately start execution. Pass references as file paths to attach as project assets.",
    schema: z.object({
      projectId: z.string(),
      title: z.string(),
      description: z.string().optional(),
      priority: Priority.optional().default("MEDIUM"),
      status: TaskStatus.optional().default("TODO"),
      labelIds: z.array(z.string()).optional(),
      subPath: z.string().optional(),
      useWorktree: z.boolean().optional().default(false),
      baseBranch: z.string().optional().describe("Base branch for worktree checkout. Only used when useWorktree=true. If omitted, auto-detects the project's current branch."),
      autoStart: z.boolean().optional().default(true),
      references: z.array(z.string()).max(20).optional(),
    }),
    handler: async (args: {
      projectId: string;
      title: string;
      description?: string;
      priority?: string;
      status?: string;
      labelIds?: string[];
      subPath?: string;
      useWorktree?: boolean;
      baseBranch?: string;
      autoStart?: boolean;
      references?: string[];
    }) => {
      // Determine baseBranch: explicit param > auto-detect from project's current git branch
      let baseBranch: string | null = null;
      if (args.useWorktree) {
        if (args.baseBranch) {
          baseBranch = args.baseBranch;
        } else {
          const project = await db.project.findUnique({ where: { id: args.projectId }, select: { localPath: true } });
          if (project?.localPath) {
            try {
              baseBranch = execFileSync("git", ["branch", "--show-current"], {
                cwd: project.localPath, encoding: "utf-8", timeout: 5000,
              }).trim() || null;
            } catch {
              // fallback: no baseBranch, task runs in direct mode
            }
          }
        }
      }

      const task = await db.task.create({
        data: {
          title: args.title,
          description: args.description,
          projectId: args.projectId,
          priority: (args.priority ?? "MEDIUM") as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
          status: (args.status ?? "TODO") as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED",
          baseBranch,
        },
      });

      if (args.labelIds && args.labelIds.length > 0) {
        await db.taskLabel.createMany({
          data: args.labelIds.map((labelId) => ({ taskId: task.id, labelId })),
        });
      }

      // Copy reference files to assets and create ProjectAsset records
      const attachedFiles: string[] = [];
      let updatedDesc: string | null = null;
      if (args.references && args.references.length > 0) {
        const assetsDir = join(MCP_PROJECT_ROOT, "data", "assets", args.projectId);
        mkdirSync(assetsDir, { recursive: true });

        for (const filePath of args.references) {
          try {
            if (!existsSync(filePath)) continue;
            const stat = statSync(filePath);
            if (!stat.isFile()) continue;

            const isCache = isAssistantCachePath(filePath);
            let filename = isCache
              ? stripCacheUuidSuffix(basename(filePath))
              : basename(filePath);
            // Avoid overwriting existing assets
            if (existsSync(join(assetsDir, filename))) {
              const ext = extname(filename);
              const base = basename(filename, ext);
              if (isCache) {
                // Use counter suffix for readable cache asset names: "设计稿 (1).png"
                let counter = 1;
                while (existsSync(join(assetsDir, `${base} (${counter})${ext}`))) {
                  counter++;
                }
                filename = `${base} (${counter})${ext}`;
              } else {
                filename = `${base}-${Date.now()}${ext}`;
              }
            }
            const dest = join(assetsDir, filename);
            copyFileSync(filePath, dest);

            await db.projectAsset.create({
              data: {
                filename,
                path: dest,
                size: stat.size,
                projectId: args.projectId,
                taskId: task.id,
                description: `Reference: ${basename(filePath)}`,
              },
            });
            attachedFiles.push(filename);
          } catch {
            // Skip files that can't be copied
          }
        }

        // Append reference info to task description with full absolute paths
        if (attachedFiles.length > 0) {
          const refText = attachedFiles.map((f) => `- ${join(assetsDir, f)}`).join("\n");
          updatedDesc = (task.description ?? "") + `\n\nAttached references:\n${refText}`;
          await db.task.update({ where: { id: task.id }, data: { description: updatedDesc } });
        }
      }

      // Auto-start execution if requested — use locally-built description (no extra DB query)
      if (args.autoStart) {
        const PORT = process.env.PORT ?? "3000";
        const prompt = updatedDesc || args.description || args.title;
        try {
          const res = await fetch(`http://localhost:${PORT}/api/internal/terminal/${task.id}/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
          });
          if (res.ok) {
            const execData = await res.json();
            return { ...task, execution: execData };
          }
        } catch {
          // Task created but auto-start failed — return task anyway
        }
      }

      return task;
    },
  },

  update_task: {
    description: "Update a task's title, description, priority, labels, and/or subPath. If labelIds is provided, replaces all existing labels.",
    schema: z.object({
      taskId: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: Priority.optional(),
      labelIds: z.array(z.string()).optional(),
      subPath: z.string().optional(),
    }),
    handler: async (args: {
      taskId: string;
      title?: string;
      description?: string;
      priority?: string;
      labelIds?: string[];
      subPath?: string;
    }) => {
      const { labelIds, taskId, ...updateData } = args;

      return db.$transaction(async (tx) => {
        const task = await tx.task.update({
          where: { id: taskId },
          data: updateData as { title?: string; description?: string; priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; subPath?: string },
        });

        if (labelIds !== undefined) {
          await tx.taskLabel.deleteMany({ where: { taskId } });
          if (labelIds.length > 0) {
            await tx.taskLabel.createMany({
              data: labelIds.map((labelId) => ({ taskId, labelId })),
            });
          }
        }

        return task;
      });
    },
  },

  move_task: {
    description: "Move a task to a different status column (e.g. TODO, IN_PROGRESS, IN_REVIEW, DONE, CANCELLED).",
    schema: z.object({
      taskId: z.string(),
      status: TaskStatus,
    }),
    handler: async (args: { taskId: string; status: string }) => {
      // Delegate to updateTaskStatus to trigger side effects (dreaming on DONE, worktree cleanup on CANCELLED, etc.)
      const { updateTaskStatus } = await import("@/actions/task-actions");
      return updateTaskStatus(args.taskId, args.status as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED");
    },
  },

  delete_task: {
    description: "Delete a task by ID.",
    schema: z.object({
      taskId: z.string(),
    }),
    handler: async (args: { taskId: string }) => {
      await db.task.delete({ where: { id: args.taskId } });
      return { deleted: true, taskId: args.taskId };
    },
  },
};
