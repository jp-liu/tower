import { z } from "zod";
import { db } from "../db";
import { queryProjectKnowledge } from "@/lib/knowledge";
import { scoreProject } from "./knowledge-tools";

const MIN_CONFIDENCE = 0.3;

/** 把项目标识（id / 名称 / alias）解析成 projectId。 */
async function resolveProjectId(
  project: string,
  workspaceId?: string
): Promise<{ projectId?: string; needsSelection?: unknown }> {
  // 先按精确 id 命中（cuid）
  const byId = await db.project.findUnique({ where: { id: project } });
  if (byId) return { projectId: byId.id };

  const projects = await db.project.findMany({
    where: workspaceId ? { workspaceId } : undefined,
    include: { workspace: true },
  });
  const scored = projects
    .map((p) => ({
      projectId: p.id,
      name: p.name,
      alias: p.alias,
      workspaceName: p.workspace.name,
      confidence: scoreProject({ name: p.name, alias: p.alias, description: p.description }, project),
    }))
    .filter((r) => r.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);

  if (scored.length === 0) return {};
  // 唯一高分（拉开差距）直接用，否则让调用方选
  if (scored.length === 1 || scored[0].confidence - scored[1].confidence >= 0.2) {
    return { projectId: scored[0].projectId };
  }
  return { needsSelection: scored.slice(0, 5) };
}

export const knowledgeBaseTools = {
  ask_project_knowledge: {
    description:
      "Answer a question about a project by aggregating its knowledge base. Fuses four sources: " +
      "(1) in-repo knowledge markdown under <localPath>/<knowledgeDir> (default docs/知识库), " +
      "(2) structured fact cards (production/CICD paths etc.), " +
      "(3) versions + their tasks' merge commits (changelog / front-back commits), " +
      "(4) DB notes (FTS). Projects sharing a productKey (e.g. front/back ends) are searched together. " +
      "Returns raw aggregated material with source citations — the CALLER composes the final answer from it. " +
      "Identify the project by exact id, or fuzzy name/alias (ambiguous → returns needsSelection).",
    schema: z.object({
      project: z.string().describe("Project id, or a fuzzy name/alias to resolve"),
      question: z.string().describe("The question to answer, used as the retrieval query"),
      workspaceId: z.string().optional().describe("Narrow fuzzy resolution to one workspace"),
    }),
    handler: async (args: { project: string; question: string; workspaceId?: string }) => {
      const { projectId, needsSelection } = await resolveProjectId(args.project, args.workspaceId);
      if (needsSelection) {
        return { needsSelection, message: "多个项目名称匹配，请用 projectId 明确指定后重试。" };
      }
      if (!projectId) {
        return { error: `未找到匹配「${args.project}」的项目。可先用 list_projects / identify_project 确认。` };
      }
      return queryProjectKnowledge(db, projectId, args.question);
    },
  },

  manage_project_facts: {
    description:
      "Manage a project's structured fact cards (key-value): production/CICD paths, domains, and other " +
      "facts a machine can't derive. These are a precise-match source for ask_project_knowledge. " +
      "Actions: set (upsert by key), delete (by key), list.",
    schema: z.object({
      action: z.enum(["set", "delete", "list"]),
      projectId: z.string(),
      key: z.string().optional().describe("Required for set/delete, e.g. '生产环境路径' / 'CICD路径'"),
      value: z.string().optional().describe("Required for set"),
    }),
    handler: async (args: { action: string; projectId: string; key?: string; value?: string }) => {
      switch (args.action) {
        case "set": {
          if (!args.key || args.value === undefined) {
            throw new Error("set 需要 key 和 value");
          }
          return db.projectFact.upsert({
            where: { projectId_key: { projectId: args.projectId, key: args.key } },
            update: { value: args.value },
            create: { projectId: args.projectId, key: args.key, value: args.value },
          });
        }
        case "delete": {
          if (!args.key) throw new Error("delete 需要 key");
          await db.projectFact.deleteMany({ where: { projectId: args.projectId, key: args.key } });
          return { deleted: true, key: args.key };
        }
        case "list":
          return db.projectFact.findMany({
            where: { projectId: args.projectId },
            orderBy: { key: "asc" },
          });
        default:
          throw new Error(`Unknown action: ${args.action}`);
      }
    },
  },
};
