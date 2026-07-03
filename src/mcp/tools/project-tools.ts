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
      "groupId assigns the project to a ProductGroup (repos of one product — front/back/trace/需求 — in " +
      "the same group are searched together by ask_project_knowledge); pass \"\" to remove from its group. " +
      "Use list_product_groups to discover group ids. knowledgeDir overrides the in-repo knowledge directory (default docs/知识库).",
    schema: z.object({
      projectId: z.string(),
      name: z.string().optional(),
      alias: z.string().optional().describe("Short alias for the project"),
      localPath: z.string().optional(),
      description: z.string().optional(),
      groupId: z.string().optional().describe('ProductGroup id to assign; "" to remove from group. Discover ids via list_product_groups.'),
      knowledgeDir: z.string().optional().describe("In-repo knowledge dir relative to localPath (default docs/知识库)"),
    }),
    handler: async (args: {
      projectId: string;
      name?: string;
      alias?: string;
      localPath?: string;
      description?: string;
      groupId?: string;
      knowledgeDir?: string;
    }) => {
      const { projectId, groupId, ...rest } = args;
      const data: Record<string, unknown> = { ...rest };
      // "" → detach from group (null); an id → attach. Omitted → leave unchanged.
      if (groupId !== undefined) {
        const normalized = groupId === "" ? null : groupId;
        // Guard: a group's members must all share one workspace — the knowledge
        // aggregator groups purely by groupId (no workspace filter), so a
        // cross-workspace assignment would leak knowledge across workspaces.
        if (normalized) {
          const [project, group] = await Promise.all([
            db.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } }),
            db.productGroup.findUnique({ where: { id: normalized }, select: { workspaceId: true } }),
          ]);
          if (!project) throw new Error("Project not found");
          if (!group) throw new Error("Product group not found");
          if (group.workspaceId !== project.workspaceId) {
            throw new Error("Group and project belong to different workspaces");
          }
        }
        data.groupId = normalized;
      }
      return db.project.update({ where: { id: projectId }, data });
    },
  },

  list_product_groups: {
    description:
      "List a workspace's product groups (with member projects) so you can pick a groupId for update_project. " +
      "A product group ties together the repos of one product (front/back/trace/需求) for knowledge Q&A.",
    schema: z.object({
      workspaceId: z.string(),
    }),
    handler: async (args: { workspaceId: string }) => {
      const groups = await db.productGroup.findMany({
        where: { workspaceId: args.workspaceId },
        orderBy: { name: "asc" },
        include: { projects: { select: { id: true, name: true, alias: true } } },
      });
      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        projects: g.projects,
      }));
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
