import { z } from "zod";
import { db } from "../db";

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
    description: "Create a new task in a project. Priority defaults to MEDIUM, status defaults to TODO. Optionally assigns labels by ID.",
    schema: z.object({
      projectId: z.string(),
      title: z.string(),
      description: z.string().optional(),
      priority: Priority.optional().default("MEDIUM"),
      status: TaskStatus.optional().default("TODO"),
      labelIds: z.array(z.string()).optional(),
    }),
    handler: async (args: {
      projectId: string;
      title: string;
      description?: string;
      priority?: string;
      status?: string;
      labelIds?: string[];
    }) => {
      const task = await db.task.create({
        data: {
          title: args.title,
          description: args.description,
          projectId: args.projectId,
          priority: (args.priority ?? "MEDIUM") as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
          status: (args.status ?? "TODO") as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED",
        },
      });

      if (args.labelIds && args.labelIds.length > 0) {
        await db.taskLabel.createMany({
          data: args.labelIds.map((labelId) => ({ taskId: task.id, labelId })),
        });
      }

      return task;
    },
  },

  update_task: {
    description: "Update a task's title, description, priority, and/or labels. If labelIds is provided, replaces all existing labels.",
    schema: z.object({
      taskId: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: Priority.optional(),
      labelIds: z.array(z.string()).optional(),
    }),
    handler: async (args: {
      taskId: string;
      title?: string;
      description?: string;
      priority?: string;
      labelIds?: string[];
    }) => {
      const { labelIds, taskId, ...updateData } = args;

      return db.$transaction(async (tx) => {
        const task = await tx.task.update({
          where: { id: taskId },
          data: updateData as { title?: string; description?: string; priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" },
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
      return db.task.update({
        where: { id: args.taskId },
        data: { status: args.status as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED" },
      });
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
