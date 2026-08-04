import { z } from "zod";
import { db } from "../db";
import { scoreProject } from "@/lib/project-score";

export { scoreProject } from "@/lib/project-score";

const MIN_CONFIDENCE = 0.3;

export const knowledgeTools = {
  identify_project: {
    description:
      "Find a project by partial name, alias, or description. Returns matches sorted by confidence score (0-1).",
    schema: z.object({
      query: z.string(),
      workspaceId: z.string().optional(),
    }),
    handler: async (args: { query: string; workspaceId?: string }) => {
      // Fetch all projects (with workspace) optionally filtered by workspaceId
      const projects = await db.project.findMany({
        where: args.workspaceId ? { workspaceId: args.workspaceId } : undefined,
        include: { workspace: true, group: true },
      });

      // Score each project
      const scored = projects
        .map((project) => ({
          projectId: project.id,
          name: project.name,
          alias: project.alias,
          workspaceId: project.workspaceId,
          workspaceName: project.workspace.name,
          confidence: scoreProject(
            {
              name: project.name,
              alias: project.alias,
              description: project.description,
              groupName: project.group?.name,
            },
            args.query
          ),
        }))
        // Filter out low-confidence results
        .filter((result) => result.confidence >= MIN_CONFIDENCE)
        // Sort by confidence descending
        .sort((a, b) => b.confidence - a.confidence);

      return scored;
    },
  },
};
