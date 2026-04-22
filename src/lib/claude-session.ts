import { execFileSync } from "child_process";

export interface DreamingResult {
  summary: string;
  insights: Array<{ type: "pattern" | "pitfall" | "decision" | "tool" | "reference"; content: string }>;
  shouldCreateNote: boolean;
  noteTitle?: string;
}

/** Resolve claude CLI binary — env var > `which claude` > fallback */
function findClaudeBinary(): string {
  if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
  try {
    return execFileSync("which", ["claude"], { encoding: "utf-8", timeout: 3000 }).trim();
  } catch {
    return "claude";
  }
}

/**
 * Run a single-turn AI query via Claude Agent SDK.
 * Unified entry point — all AI capabilities route through here.
 */
export async function aiQuery(prompt: string, cwd: string, maxTurns = 1): Promise<string | null> {
  try {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const claudePath = findClaudeBinary();

    let result = "";
    const q = query({
      prompt,
      options: {
        tools: [],
        allowedTools: [],
        maxTurns,
        cwd,
        pathToClaudeCodeExecutable: claudePath,
        sessionPersistence: false,
      } as Parameters<typeof query>[0]["options"],
    });

    for await (const msg of q) {
      if (msg.type === "assistant") {
        const textBlocks = msg.message.content.filter(
          (b: { type: string }) => b.type === "text"
        );
        result += textBlocks
          .map((b: { type: string; text?: string }) => b.text ?? "")
          .join("");
      }
    }

    return result.trim() || null;
  } catch (err) {
    console.error("[aiQuery] Failed:", (err as Error).message?.slice(0, 100));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Small summary — stop 时生成
// ---------------------------------------------------------------------------

/**
 * Generate an AI summary from terminal log content.
 * Uses Agent SDK for unified AI access.
 */
export async function generateSummaryFromLog(
  terminalLog: string,
  cwd: string
): Promise<string | null> {
  const prompt = `以下是一次AI编程助手的终端会话记录。请用一句简短的中文总结这次会话做了什么（不超过50字，只回答总结内容，不要加引号或前缀）：

\`\`\`
${terminalLog.slice(-5000)}
\`\`\``;

  const result = await aiQuery(prompt, cwd);
  if (!result) return null;
  return result.replace(/^[#*\->"'\s]+/, "").trim() || null;
}

// ---------------------------------------------------------------------------
// Dreaming — 任务 DONE 时生成
// ---------------------------------------------------------------------------

/**
 * Generate dreaming insights from a completed session.
 * Uses Agent SDK for unified AI access.
 */
export async function generateDreamingInsight(
  terminalLog: string,
  cwd: string,
  aiSummary: string | null
): Promise<DreamingResult | null> {
  const logSnippet = terminalLog.slice(-8000);
  const summaryContext = aiSummary ? `\nSession summary: ${aiSummary}` : "";

  const prompt = `You are analyzing a completed AI coding session. Extract reusable insights.
${summaryContext}

Terminal log (last 8000 chars):
\`\`\`
${logSnippet}
\`\`\`

Respond ONLY with valid JSON matching this schema (no markdown, no explanation):
{
  "summary": "one-sentence summary of what was accomplished",
  "insights": [
    { "type": "pattern|pitfall|decision|tool|reference", "content": "description" }
  ],
  "shouldCreateNote": true/false,
  "noteTitle": "short title for the note (only if shouldCreateNote is true)"
}

Rules:
- Set shouldCreateNote=true ONLY if there are genuinely reusable insights (architectural decisions, non-obvious pitfalls, useful patterns, important tool discoveries)
- Trivial sessions (simple formatting, single-line edits, routine commits) should have shouldCreateNote=false
- insights array can be empty if nothing notable
- Keep each insight concise (1-2 sentences)`;

  const result = await aiQuery(prompt, cwd);
  if (!result) return null;

  try {
    let jsonStr = result;
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr) as DreamingResult;

    if (typeof parsed.summary !== "string" || typeof parsed.shouldCreateNote !== "boolean") {
      console.error("[generateDreamingInsight] Invalid response structure");
      return null;
    }

    return parsed;
  } catch (parseErr) {
    console.error("[generateDreamingInsight] JSON parse failed:", (parseErr as Error).message);
    return null;
  }
}
