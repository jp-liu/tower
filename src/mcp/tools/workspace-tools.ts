import { z } from "zod";
import { db } from "../db";

export const workspaceTools = {
  list_workspaces: {
    description: "List all workspaces ordered by last updated, including project count for each.",
    schema: z.object({}),
    handler: async (_args: Record<string, never>) => {
      const workspaces = await db.workspace.findMany({
        include: {
          projects: {
            select: { id: true },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      return workspaces.map((workspace) => ({
        ...workspace,
        projectCount: workspace.projects.length,
        projects: undefined,
      }));
    },
  },

  create_workspace: {
    description: "Create a new workspace with a name and optional description.",
    schema: z.object({
      name: z.string(),
      description: z.string().optional(),
    }),
    handler: async (args: { name: string; description?: string }) => {
      return db.workspace.create({
        data: {
          name: args.name,
          description: args.description,
        },
      });
    },
  },

  update_workspace: {
    description: "Update an existing workspace's name and/or description.",
    schema: z.object({
      workspaceId: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
    }),
    handler: async (args: { workspaceId: string; name?: string; description?: string }) => {
      return db.workspace.update({
        where: { id: args.workspaceId },
        data: {
          name: args.name,
          description: args.description,
        },
      });
    },
  },

  delete_workspace: {
    description: "Delete a workspace by ID. Cascade delete is handled by the Prisma schema.",
    schema: z.object({
      workspaceId: z.string(),
    }),
    handler: async (args: { workspaceId: string }) => {
      await db.workspace.delete({ where: { id: args.workspaceId } });
      return { deleted: true, workspaceId: args.workspaceId };
    },
  },
};
