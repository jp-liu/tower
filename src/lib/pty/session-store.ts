import { PtySession } from "./pty-session";
import path from "path";
import { execSync } from "child_process";

// D-04: globalThis singleton — survives HMR/module re-evaluation in Next.js dev mode.
// Without this, ws-server.ts (loaded once via instrumentation) and agent-actions.ts
// (re-bundled on HMR) would get different Map instances, causing sessions to be invisible
// to the WS server after creation.
const g = globalThis as typeof globalThis & { __ptySessions?: Map<string, PtySession> };
if (!g.__ptySessions) {
  g.__ptySessions = new Map<string, PtySession>();
}
const sessions = g.__ptySessions;

/**
 * On Windows, find the actual executable path for a command.
 * e.g. "claude" -> "E:\nodejs\claude.cmd"
 *
 * Note: where.exe returns paths in PATH order, but may return:
 * - E:\nodejs\claude (shim without extension)
 * - E:\nodejs\claude.cmd (actual executable)
 * We should prefer .cmd/.bat over no-extension paths.
 */
function findExecutablePath(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }

  // If it has an extension already, return as-is
  if (path.extname(command)) {
    return command;
  }

  try {
    // Use where.exe to find the command in PATH
    const result = execSync(`where ${command}`, { encoding: "utf-8", timeout: 5000 });
    const foundPaths = result.trim().split("\n").map(p => p.trim()).filter(Boolean);

    // Prefer .cmd/.bat over no-extension paths (which are usually shims)
    const withExt = foundPaths.find(p => /\.(cmd|bat|exe)$/i.test(p));
    if (withExt) {
      console.error(`[findExecutablePath] found with ext: ${withExt}`);
      return withExt;
    }

    // Fallback to first result
    if (foundPaths.length > 0) {
      console.error(`[findExecutablePath] no ext, using: ${foundPaths[0]}`);
      return foundPaths[0];
    }
  } catch {
    // Command not found in PATH, return as-is
  }

  return command;
}

/** Quote for inner `cmd /c` line. Flatten `\n` (unsafe in one CreateProcess line); double `"` as CMD requires. */
function quoteForCmd(arg: string): string {
  const flat = arg.replace(/\r\n|\r|\n/g, " ");
  if (!flat.length) return '""';
  const escaped = flat.replace(/"/g, '""');
  return /[\s"&<>|^()]/.test(escaped) ? `"${escaped}"` : escaped;
}

/**
 * Resolves command for Windows PTY spawning.
 * On Windows, .cmd/.bat files need to be run via cmd.exe.
 */
function resolvePtyCommand(command: string, args: string[]): { command: string; args: string[] } {
  console.error(`[resolvePtyCommand] input: command=${command}, args=${JSON.stringify(args)}, platform=${process.platform}`);

  // First, find the actual executable path on Windows
  const resolvedCommand = findExecutablePath(command);
  console.error(`[resolvePtyCommand] resolved: command=${resolvedCommand}`);

  if (process.platform !== "win32") {
    return { command: resolvedCommand, args };
  }

  const ext = path.extname(resolvedCommand).toLowerCase();
  console.error(`[resolvePtyCommand] ext=${ext}, isWindowsCmd=${ext === ".cmd" || ext === ".bat" || ext === ".com"}`);

  if (ext === ".cmd" || ext === ".bat" || ext === ".com") {
    const shell = process.env.ComSpec || "cmd.exe";
    // Must quote each argv for cmd's parser: spaces/newlines in prompts and
    // `--append-system-prompt` values otherwise split into wrong tokens or break `/c`.
    const commandLine = [quoteForCmd(resolvedCommand), ...args.map(quoteForCmd)].join(" ");
    console.error(`[resolvePtyCommand] wrapping with cmd.exe: ${shell} /d /s /c ${commandLine}`);
    return {
      command: shell,
      args: ["/d", "/s", "/c", commandLine],
    };
  }

  return { command: resolvedCommand, args };
}

export function createSession(
  taskId: string,
  command: string,
  args: string[],
  cwd: string,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void,
  envOverrides?: Record<string, string>,
  onIdle?: () => void,
  idleThresholdMs?: number
): PtySession {
  // Destroy any existing session for this taskId before creating new one
  destroySession(taskId);

  // Resolve command for Windows PTY (handle .cmd/.bat files)
  const { command: resolvedCommand, args: resolvedArgs } = resolvePtyCommand(command, args);

  console.error(`[createSession] final: command=${resolvedCommand}`);
  console.error(`[createSession] args=${JSON.stringify(resolvedArgs)}`);
  console.error(`[createSession] cwd=${cwd}`);

  const session = new PtySession(taskId, resolvedCommand, resolvedArgs, cwd, onData, onExit, envOverrides, onIdle, idleThresholdMs);
  sessions.set(taskId, session);
  return session;
}

export function getSession(taskId: string): PtySession | undefined {
  return sessions.get(taskId);
}

export function destroySession(taskId: string): void {
  const session = sessions.get(taskId);
  if (!session) return;
  sessions.delete(taskId);
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
  }
  session.kill();
}

/** D-08: Called on SIGTERM — kills all sessions */
export function destroyAllSessions(): void {
  for (const taskId of sessions.keys()) {
    destroySession(taskId);
  }
}

// D-08: Register SIGTERM/SIGINT cleanup handler
// Use once() to prevent listener accumulation across HMR reloads
process.once("SIGTERM", () => {
  console.error("[session-store] SIGTERM received — cleaning up PTY sessions");
  destroyAllSessions();
});
process.once("SIGINT", () => {
  console.error("[session-store] SIGINT received — cleaning up PTY sessions");
  destroyAllSessions();
});
