"use server";

import { execFile, execFileSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { z } from "zod";
import { getConfigValue } from "@/actions/config-actions";
import { getExtensionsDir } from "@/lib/tower-dir";

export type SearchErrorKind =
  | "timeout"
  | "not_installed"
  | "permission_denied"
  | "aborted"
  | "unknown";

/** Resolve rg binary: extension install in `~/.tower/extensions/` first,
 * system rg fallback. Verifies the binary file actually exists — the
 * `@vscode/ripgrep` package may install while its postinstall download
 * silently fails, leaving `rgPath` pointing at a missing file. */
function resolveRgPath(): string {
  try {
    const pkgEntry = path.join(getExtensionsDir(), "node_modules", "@vscode", "ripgrep");
    if (existsSync(pkgEntry)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkgPath = (require(pkgEntry) as { rgPath: string }).rgPath;
      if (pkgPath && existsSync(pkgPath)) return pkgPath;
    }
  } catch {
    // extension workspace doesn't have it — fall through to system fallback
  }
  try {
    const sysPath = execFileSync("which", ["rg"], { encoding: "utf-8" }).trim();
    if (sysPath && existsSync(sysPath)) return sysPath;
  } catch {
    // which failed (e.g. Windows without WSL) — fall through
  }
  // Windows fallback: `where rg`
  if (process.platform === "win32") {
    try {
      const sysPath = execFileSync("where", ["rg"], { encoding: "utf-8" })
        .split(/\r?\n/)[0]
        .trim();
      if (sysPath && existsSync(sysPath)) return sysPath;
    } catch {
      // not on PATH
    }
  }
  throw new Error("ripgrep not found: install @vscode/ripgrep or system rg");
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

/**
 * Clear cached rg binary path. Called after extension install/uninstall
 * (in `lib/extensions/definitions/ripgrep.ts`) to force re-resolution
 * on the next searchCode call.
 */
export async function clearRgPathCache(): Promise<void> {
  _rgPath = undefined;
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
