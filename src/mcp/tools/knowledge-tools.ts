import { z } from "zod";
import { db } from "../db";

// Scoring constants
const NAME_EXACT = 1.0;
const NAME_STARTS_WITH = 0.9;
const NAME_CONTAINS = 0.75;
const ALIAS_EXACT = 0.85;
const ALIAS_STARTS_WITH = 0.75;
const ALIAS_CONTAINS = 0.6;
const DESC_CONTAINS = 0.4;
const MIN_CONFIDENCE = 0.3;

interface ProjectFields {
  name: string;
  alias: string | null;
  description?: string | null;
}

/**
 * Score a project against a query string.
 * Returns a confidence value between 0 and 1.
 * Name match > alias match > description match.
 */
export function scoreProject(project: ProjectFields, query: string): number {
  const q = query.toLowerCase();
  const name = project.name.toLowerCase();

  // Name scoring
  let nameScore = 0;
  if (name === q) {
    nameScore = NAME_EXACT;
  } else if (name.startsWith(q)) {
    nameScore = NAME_STARTS_WITH;
  } else if (name.includes(q)) {
    nameScore = NAME_CONTAINS;
  }

  // Alias scoring
  let aliasScore = 0;
  if (project.alias) {
    const alias = project.alias.toLowerCase();
    if (alias === q) {
      aliasScore = ALIAS_EXACT;
    } else if (alias.startsWith(q)) {
      aliasScore = ALIAS_STARTS_WITH;
    } else if (alias.includes(q)) {
      aliasScore = ALIAS_CONTAINS;
    }
  }

  // Description scoring
  let descScore = 0;
  if (project.description) {
    const desc = project.description.toLowerCase();
    if (desc.includes(q)) {
      descScore = DESC_CONTAINS;
    }
  }

  return Math.max(nameScore, aliasScore, descScore);
}

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
        include: { workspace: true },
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
            { name: project.name, alias: project.alias, description: project.description },
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
