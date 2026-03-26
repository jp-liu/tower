import { z } from "zod";
import { db } from "../db";

export const labelTools = {
  list_labels: {
    description: "List all labels available for a workspace, including builtin labels and workspace-specific labels.",
    schema: z.object({
      workspaceId: z.string(),
    }),
    handler: async (args: { workspaceId: string }) => {
      return db.label.findMany({
        where: {
          OR: [
            { isBuiltin: true },
            { workspaceId: args.workspaceId },
          ],
        },
        orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
      });
    },
  },

  create_label: {
    description: "Create a custom label for a workspace with a name and color.",
    schema: z.object({
      workspaceId: z.string(),
      name: z.string(),
      color: z.string(),
    }),
    handler: async (args: { workspaceId: string; name: string; color: string }) => {
      return db.label.create({
        data: {
          name: args.name,
          color: args.color,
          workspaceId: args.workspaceId,
        },
      });
    },
  },

  delete_label: {
    description: "Delete a label by ID.",
    schema: z.object({
      labelId: z.string(),
    }),
    handler: async (args: { labelId: string }) => {
      await db.label.delete({ where: { id: args.labelId } });
      return { deleted: true };
    },
  },

  set_task_labels: {
    description: "Replace all labels on a task with the provided list of label IDs.",
    schema: z.object({
      taskId: z.string(),
      labelIds: z.array(z.string()),
    }),
    handler: async (args: { taskId: string; labelIds: string[] }) => {
      await db.taskLabel.deleteMany({ where: { taskId: args.taskId } });
      if (args.labelIds.length > 0) {
        await db.taskLabel.createMany({
          data: args.labelIds.map((labelId) => ({ taskId: args.taskId, labelId })),
        });
      }
      return { taskId: args.taskId, labelIds: args.labelIds };
    },
  },
};
