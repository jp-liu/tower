import { execFile, execFileSync } from "child_process";

/** Resolve claude CLI binary — env var > `which claude` > fallback */
function findClaudeBinary(): string {
  if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
  try {
    return execFileSync("which", ["claude"], { encoding: "utf-8", timeout: 3000 }).trim();
  } catch {
    return "claude";
  }
}

export interface DreamingResult {
  summary: string;
  insights: Array<{ type: "pattern" | "pitfall" | "decision" | "tool" | "reference"; content: string }>;
  shouldCreateNote: boolean;
  noteTitle?: string;
}

/**
 * Generate an AI summary from terminal log content.
 * Uses `claude -p` with --no-session-persistence to avoid polluting any session.
 * Runs asynchronously — returns a Promise.
 */
export function generateSummaryFromLog(
  terminalLog: string,
  cwd: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const prompt = `以下是一次AI编程助手的终端会话记录。请用一句简短的中文总结这次会话做了什么（不超过50字，只回答总结内容，不要加引号或前缀）：

\`\`\`
${terminalLog.slice(-5000)}
\`\`\``;

    execFile(
      findClaudeBinary(),
      ["-p", prompt, "--no-session-persistence", "--max-turns", "1"],
      {
        cwd,
        timeout: 30_000,
        encoding: "utf-8",
        env: { ...process.env, DATABASE_URL: undefined },
      },
      (err, stdout) => {
        if (err) {
          console.error("[generateSummaryFromLog] Failed:", err.message?.slice(0, 100));
          resolve(null);
          return;
        }
        const result = stdout.trim().replace(/^[#*\->"'\s]+/, "").trim();
        resolve(result || null);
      }
    );
  });
}

/**
 * Generate dreaming insights from a completed session.
 * Uses `claude -p` to analyze the terminal log and produce structured JSON.
 * Returns null on any failure (timeout, parse error, etc).
 */
export function generateDreamingInsight(
  terminalLog: string,
  cwd: string,
  aiSummary: string | null
): Promise<DreamingResult | null> {
  return new Promise((resolve) => {
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

    execFile(
      findClaudeBinary(),
      ["-p", prompt, "--no-session-persistence", "--max-turns", "1"],
      {
        cwd,
        timeout: 60_000,
        encoding: "utf-8",
        env: { ...process.env, DATABASE_URL: undefined },
      },
      (err, stdout) => {
        if (err) {
          console.error("[generateDreamingInsight] Failed:", err.message?.slice(0, 100));
          resolve(null);
          return;
        }

        try {
          // Try to extract JSON from the response (handle potential markdown wrapping)
          let jsonStr = stdout.trim();
          const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            jsonStr = jsonMatch[0];
          }
          const parsed = JSON.parse(jsonStr) as DreamingResult;

          // Basic validation
          if (typeof parsed.summary !== "string" || typeof parsed.shouldCreateNote !== "boolean") {
            console.error("[generateDreamingInsight] Invalid response structure");
            resolve(null);
            return;
          }

          resolve(parsed);
        } catch (parseErr) {
          console.error("[generateDreamingInsight] JSON parse failed:", (parseErr as Error).message);
          resolve(null);
        }
      }
    );
  });
}
