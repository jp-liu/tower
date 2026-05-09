"use server";

import { execFile, execFileSync } from "child_process";
import { z } from "zod";
import { getConfigValue } from "@/actions/config-actions";

export type SearchErrorKind =
  | "timeout"
  | "not_installed"
  | "permission_denied"
  | "aborted"
  | "unknown";

/** Resolve rg binary: bundled @vscode/ripgrep → system rg fallback */
function resolveRgPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("@vscode/ripgrep") as { rgPath: string }).rgPath;
  } catch {
    try {
      return execFileSync("which", ["rg"], { encoding: "utf-8" }).trim();
    } catch {
      throw new Error("ripgrep not found: install @vscode/ripgrep or system rg");
    }
  }
}

let _rgPath: string | undefined;
function getRgPath(): string {
  if (!_rgPath) _rgPath = resolveRgPath();
  return _rgPath;
}

// ---------------------------------------------------------------------------
// Check rg availability (for UI to show install prompt)
// ---------------------------------------------------------------------------

export async function checkRgAvailable(): Promise<{ available: boolean; platform: string }> {
  try {
    getRgPath();
    return { available: true, platform: process.platform };
  } catch {
    return { available: false, platform: process.platform };
  }
}

// ---------------------------------------------------------------------------
// Install rg via platform package manager
// ---------------------------------------------------------------------------

/**
 * Clear cached rg binary path. Called after extension install/uninstall
 * to force re-resolution on next searchCode call.
 */
export async function clearRgPathCache(): Promise<void> {
  _rgPath = undefined;
}

export async function installRg(): Promise<{ success: boolean; error?: string }> {
  const platform = process.platform;
  let cmd: string;
  let args: string[];

  if (platform === "darwin") {
    cmd = "brew";
    args = ["install", "ripgrep"];
  } else if (platform === "win32") {
    cmd = "winget";
    args = ["install", "BurntSushi.ripgrep.MSVC", "--accept-source-agreements", "--accept-package-agreements"];
  } else {
    // Linux: try apt, fall back to snap
    cmd = "sudo";
    args = ["apt-get", "install", "-y", "ripgrep"];
  }

  try {
    await execFileAsync(cmd, args, {
      encoding: "utf-8",
      timeout: 120_000,
    });
    // Clear cached path so it re-resolves
    _rgPath = undefined;
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

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
  aborted?: boolean;
  error?: string;
  errorKind?: SearchErrorKind;
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
  opts: {
    encoding: string;
    maxBuffer?: number;
    stdio?: unknown;
    timeout?: number;
    signal?: AbortSignal;
  }
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      opts as Parameters<typeof execFile>[2],
      (err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
        if (err) {
          // Attach stderr for downstream categorization
          (err as Error & { stderr?: string }).stderr =
            typeof stderr === "string" ? stderr : stderr?.toString();
          reject(err);
        } else {
          resolve(typeof stdout === "string" ? stdout : stdout.toString());
        }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Categorize ripgrep failure into SearchErrorKind
// ---------------------------------------------------------------------------

function categorizeRgError(
  err: Error & {
    code?: number | string;
    killed?: boolean;
    signal?: string;
    stderr?: string;
    name?: string;
  }
): { kind: SearchErrorKind; message: string } {
  if (err.name === "AbortError") {
    return { kind: "aborted", message: "" };
  }
  if (err.killed && (err.signal === "SIGTERM" || err.signal === "SIGKILL")) {
    return { kind: "timeout", message: err.message ?? "search timed out" };
  }
  const stderr = err.stderr ?? "";
  const combined = `${err.message ?? ""} ${stderr}`.toLowerCase();
  if (combined.includes("permission denied") || combined.includes("eacces")) {
    return {
      kind: "permission_denied",
      message: stderr || err.message || "permission denied",
    };
  }
  if (
    combined.includes("not found") ||
    combined.includes("enoent") ||
    combined.includes("ripgrep")
  ) {
    return {
      kind: "not_installed",
      message: stderr || err.message || "ripgrep not found",
    };
  }
  return {
    kind: "unknown",
    message: (stderr || err.message || "unknown error").slice(0, 200),
  };
}

// ---------------------------------------------------------------------------
// searchCode server action
// ---------------------------------------------------------------------------

export async function searchCode(
  localPath: string,
  pattern: string,
  glob?: string,
  maxResults: number = 200,
  signal?: AbortSignal
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

  // 2. Guard: localPath must be absolute (Unix: /path, Windows: C:\path)
  const isAbsolute = safePath.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(safePath);
  if (!isAbsolute) {
    return {
      matches: [],
      truncated: false,
      error: "localPath must be an absolute path",
    };
  }

  // 3. Resolve rg path; not_installed is a categorical error
  let rgPath: string;
  try {
    rgPath = getRgPath();
  } catch (err) {
    return {
      matches: [],
      truncated: false,
      error: (err as Error).message.slice(0, 200),
      errorKind: "not_installed",
    };
  }

  // 4. Build rg args (using bundled @vscode/ripgrep binary)
  const args: string[] = ["--json", "-n", safePattern];
  if (safeGlob) {
    args.push("--glob", safeGlob);
  }
  args.push(safePath);

  // 5. Read configured timeout (RELI-03)
  const timeoutSec = await getConfigValue<number>("search.codeTimeoutSec", 30);
  const timeoutMs = Math.max(1, timeoutSec) * 1000;

  // 6. Run rg (async — does not block event loop)
  // Server Actions cannot transport AbortSignal across the RPC boundary —
  // if the value isn't a real AbortSignal (e.g., it was deserialized from a
  // client call), drop it. Cancellation is then UI-side only (generation
  // counter discards the late result; server process exits at timeout).
  const safeSignal = signal instanceof AbortSignal ? signal : undefined;
  let output: string;
  try {
    output = await execFileAsync(rgPath, args, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: timeoutMs,
      signal: safeSignal,
    });
  } catch (err) {
    const rgErr = err as Error & {
      code?: number;
      killed?: boolean;
      signal?: string;
      stderr?: string;
      name?: string;
    };
    // exit code 1 = no matches (not an error)
    if (rgErr.code === 1) {
      return { matches: [], truncated: false };
    }
    const categorized = categorizeRgError(rgErr);
    if (categorized.kind === "aborted") {
      return { matches: [], truncated: false, aborted: true };
    }
    console.error("[searchCode] rg failed:", err);
    return {
      matches: [],
      truncated: false,
      error: categorized.message.slice(0, 200),
      errorKind: categorized.kind,
    };
  }

  // 7. Parse output: split by "\n", JSON.parse each line, filter type==="match"
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

    // 8. Build SearchMatch — strip localPath prefix for relative filePath
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

  // 9. Truncate at maxResults
  const truncated = matches.length > safeMaxResults;
  const finalMatches = truncated ? matches.slice(0, safeMaxResults) : matches;

  return { matches: finalMatches, truncated };
}
