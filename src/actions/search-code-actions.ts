"use server";

import { execFile } from "child_process";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchMatch {
  filePath: string;
  lineNumber: number;
  lineText: string;
  submatches: Array<{ start: number; end: number }>;
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const searchCodeSchema = z.object({
  localPath: z.string().min(1),
  pattern: z.string().min(1).max(500),
  glob: z.string().max(200).optional(),
  maxResults: z.number().int().min(1).max(500).default(200),
});

// ---------------------------------------------------------------------------
// rg JSON output types
// ---------------------------------------------------------------------------

interface RgMatchData {
  path: { text: string };
  lines: { text: string };
  line_number: number;
  absolute_offset: number;
  submatches: Array<{ match: { text: string }; start: number; end: number }>;
}

interface RgLine {
  type: string;
  data: RgMatchData;
}

// ---------------------------------------------------------------------------
// Async execFile helper
// ---------------------------------------------------------------------------

function execFileAsync(
  cmd: string,
  args: string[],
  opts: { encoding: string; maxBuffer?: number; stdio?: unknown; timeout?: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts as Parameters<typeof execFile>[2], (err: Error | null, stdout: string | Buffer) => {
      if (err) {
        reject(err);
      } else {
        resolve(typeof stdout === "string" ? stdout : stdout.toString());
      }
    });
  });
}

// ---------------------------------------------------------------------------
// searchCode server action
// ---------------------------------------------------------------------------

export async function searchCode(
  localPath: string,
  pattern: string,
  glob?: string,
  maxResults: number = 200
): Promise<SearchResult> {
  // 1. Validate inputs with Zod
  const parsed = searchCodeSchema.safeParse({ localPath, pattern, glob, maxResults });
  if (!parsed.success) {
    return {
      matches: [],
      truncated: false,
      error: `Invalid input: ${parsed.error.message}`,
    };
  }

  const {
    localPath: safePath,
    pattern: safePattern,
    glob: safeGlob,
    maxResults: safeMaxResults,
  } = parsed.data;

  // 2. Guard: localPath must be absolute
  if (!safePath.startsWith("/")) {
    return {
      matches: [],
      truncated: false,
      error: "localPath must be an absolute path (start with /)",
    };
  }

  // 3. Check rg availability (async)
  try {
    await execFileAsync("which", ["rg"], { encoding: "utf-8" });
  } catch {
    return {
      matches: [],
      truncated: false,
      error: "ripgrep (rg) is not installed. Install with: brew install ripgrep",
    };
  }

  // 4. Build rg args
  const args: string[] = ["--json", "-n", safePattern];
  if (safeGlob) {
    args.push("--glob", safeGlob);
  }
  args.push(safePath);

  // 5. Run rg (async — does not block event loop)
  let output: string;
  try {
    output = await execFileAsync("rg", args, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 10_000,
    });
  } catch (err) {
    const rgErr = err as { code?: number; message?: string };
    // exit code 1 = no matches (not an error)
    if (rgErr.code === 1) {
      return { matches: [], truncated: false };
    }
    // any other exit code is an actual error — sanitize message
    console.error("[searchCode] rg failed:", err);
    return {
      matches: [],
      truncated: false,
      error: "搜索失败，请重试",
    };
  }

  // 6. Parse output: split by "\n", JSON.parse each line, filter type==="match"
  const lines = output.split("\n");
  const matches: SearchMatch[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsedLine: RgLine;
    try {
      parsedLine = JSON.parse(trimmed) as RgLine;
    } catch {
      continue;
    }

    if (parsedLine.type !== "match") continue;

    const data = parsedLine.data;

    // 7. Build SearchMatch — strip localPath prefix for relative filePath
    const absoluteFilePath = data.path.text;
    const prefix = safePath.endsWith("/") ? safePath : safePath + "/";
    const filePath = absoluteFilePath.startsWith(prefix)
      ? absoluteFilePath.slice(prefix.length)
      : absoluteFilePath;

    const lineText = data.lines.text.replace(/\r?\n$/, "");

    const submatches = data.submatches.map((sm) => ({
      start: sm.start,
      end: sm.end,
    }));

    matches.push({
      filePath,
      lineNumber: data.line_number,
      lineText,
      submatches,
    });
  }

  // 8. Truncate at maxResults
  const truncated = matches.length > safeMaxResults;
  const finalMatches = truncated ? matches.slice(0, safeMaxResults) : matches;

  return { matches: finalMatches, truncated };
}
