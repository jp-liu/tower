import "server-only";

import { z } from "zod";
import {
  generateCapabilityStructured,
  generateCapabilityText,
  type OneShotCapabilitySlot,
} from "@/lib/ai/capability-executor";

const insightTypeSchema = z.enum(["pattern", "pitfall", "decision", "tool", "reference"]);
const dreamingResultSchema = z.object({
  summary: z.string().trim().min(1),
  insights: z.array(z.object({
    type: insightTypeSchema,
    content: z.string().trim().min(1),
  }).strict()),
  shouldCreateNote: z.boolean(),
  noteTitle: z.string().trim().min(1).optional(),
}).strict();

export type DreamingResult = z.infer<typeof dreamingResultSchema>;

const DREAMING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "insights", "shouldCreateNote"],
  properties: {
    summary: { type: "string", minLength: 1 },
    insights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "content"],
        properties: {
          type: { enum: insightTypeSchema.options },
          content: { type: "string", minLength: 1 },
        },
      },
    },
    shouldCreateNote: { type: "boolean" },
    noteTitle: { type: "string", minLength: 1 },
  },
} satisfies Record<string, unknown>;

export interface AiQueryOptions {
  slot: OneShotCapabilitySlot;
  maxTurns?: number;
  maxOutputTokens?: number;
  maxOutputChars?: number;
  temperature?: number;
  systemPrompt?: string;
  model?: string;
  tools?: string[];
  allowedTools?: string[];
  signal?: AbortSignal;
  correlationId?: string;
}

/** Compatibility entry point for one-shot background capabilities. */
export function aiQuery(prompt: string, cwd: string, opts: AiQueryOptions): Promise<string> {
  return generateCapabilityText({ prompt, cwd, ...opts });
}

export async function generateSummaryFromLog(
  terminalLog: string,
  cwd: string,
  correlationId?: string,
): Promise<string> {
  const prompt = `以下是一次AI编程助手的终端会话记录。请用一句简短的中文总结这次会话做了什么（不超过50字，只回答总结内容，不要加引号或前缀）：

\`\`\`
${terminalLog.slice(-5000)}
\`\`\``;

  const result = await generateCapabilityText({
    slot: "summary",
    prompt,
    cwd,
    correlationId,
    maxTurns: 1,
    maxOutputTokens: 100,
    maxOutputChars: 200,
    temperature: 0.2,
  });
  return result.replace(/^[#*\->"'\s]+/, "").trim();
}

export async function generateDreamingInsight(
  terminalLog: string,
  cwd: string,
  aiSummary: string | null,
  correlationId?: string,
): Promise<DreamingResult> {
  const logSnippet = terminalLog.slice(-8000);
  const summaryContext = aiSummary ? `\nSession summary: ${aiSummary}` : "";
  const prompt = `You are analyzing a completed AI coding session. Extract reusable insights.
${summaryContext}

Terminal log (last 8000 chars):
\`\`\`
${logSnippet}
\`\`\`

Return one JSON object matching the supplied schema. Set shouldCreateNote=true only for genuinely reusable architectural decisions, non-obvious pitfalls, patterns, references, or tool discoveries. Trivial sessions must set it to false. Keep each insight to 1-2 sentences.`;

  return generateCapabilityStructured({
    slot: "dreaming",
    prompt,
    cwd,
    correlationId,
    maxTurns: 1,
    maxOutputTokens: 1000,
    maxOutputChars: 8 * 1024,
    temperature: 0.2,
    schema: DREAMING_JSON_SCHEMA,
    schemaName: "tower_dreaming_insight",
    schemaDescription: "Reusable insights extracted from a completed coding task",
    parse: (value) => dreamingResultSchema.parse(value),
  });
}
