import { z } from "zod";
import { db } from "../db";

export const projectTools = {
  list_projects: {
    description: "List all projects in a workspace ordered by last updated, including task and repository counts.",
    schema: z.object({
      workspaceId: z.string(),
    }),
    handler: async (args: { workspaceId: string }) => {
      const projects = await db.project.findMany({
        where: { workspaceId: args.workspaceId },
        include: {
          tasks: { select: { id: true } },
          repositories: { select: { id: true } },
        },
        orderBy: { updatedAt: "desc" },
      });

      return projects.map(({ tasks, repositories, ...rest }) => ({
        ...rest,
        taskCount: tasks.length,
        repositoryCount: repositories.length,
      }));
    },
  },

  create_project: {
    description: "Create a new project in a workspace. Type is derived from gitUrl: GIT if provided, NORMAL otherwise.",
    schema: z.object({
      workspaceId: z.string(),
      name: z.string(),
      alias: z.string().optional().describe("Short alias for the project"),
      gitUrl: z.string().optional(),
      localPath: z.string().optional(),
    }),
    handler: async (args: { workspaceId: string; name: string; alias?: string; gitUrl?: string; localPath?: string }) => {
      return db.project.create({
        data: {
          name: args.name,
          alias: args.alias,
          type: args.gitUrl ? "GIT" : "NORMAL",
          gitUrl: args.gitUrl,
          localPath: args.localPath,
          workspaceId: args.workspaceId,
        },
      });
    },
  },

  update_project: {
    description:
      "Update an existing project's name, localPath, description, and/or knowledge-base settings. " +
      "productKey groups repos of one product (e.g. front/back ends share a value) so ask_project_knowledge " +
      "searches them together. knowledgeDir overrides the in-repo knowledge directory (default docs/知识库).",
    schema: z.object({
      projectId: z.string(),
      name: z.string().optional(),
      alias: z.string().optional().describe("Short alias for the project"),
      localPath: z.string().optional(),
      description: z.string().optional(),
      productKey: z.string().optional().describe("Product group key; projects sharing it are searched together"),
      knowledgeDir: z.string().optional().describe("In-repo knowledge dir relative to localPath (default docs/知识库)"),
    }),
    handler: async (args: {
      projectId: string;
      name?: string;
      alias?: string;
      localPath?: string;
      description?: string;
      productKey?: string;
      knowledgeDir?: string;
    }) => {
      const { projectId, ...data } = args;
      return db.project.update({
        where: { id: projectId },
        data,
      });
    },
  },

  delete_project: {
    description: "Delete a project by ID.",
    schema: z.object({
      projectId: z.string(),
    }),
    handler: async (args: { projectId: string }) => {
      await db.project.delete({ where: { id: args.projectId } });
      return { deleted: true, projectId: args.projectId };
    },
  },
};
