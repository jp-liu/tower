import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Orphan process reaping across Tower restarts.
 *
 * `killTree()` (see pty-session.ts) reaps a session's process group when Tower
 * shuts down or stops a task gracefully. But if Tower itself is hard-killed
 * (SIGKILL, OOM, crash), its in-memory session registry is lost and the claude
 * CLI process groups it spawned are orphaned (reparented to pid 1) — leaking as
 * residual node processes that no later run knows about.
 *
 * To close that gap we persist each spawned session's pid to a small file under
 * $TMPDIR/tower-signals/ (the same dir used for exit signals). On the next boot
 * we read those files and reap any still-alive group, then clear the file. The
 * file is deleted on clean session teardown, so a leftover file specifically
 * marks a process that escaped normal cleanup.
 *
 * Safety: a pid can be recycled by the OS to an unrelated process between the
 * crash and the restart. We therefore verify, before killing, that the pid is
 * still alive AND its command line matches one of the CLI binaries Tower spawns.
 * If verification fails we skip the kill and just drop the stale file.
 */

const SIGNAL_DIR = join(tmpdir(), "tower-signals");
const PID_PREFIX = "pid-";

/** Substrings that identify a process as a CLI Tower spawned (see security.md allowlist). */
const CLI_MARKERS = ["claude", "claude-code", "codex"];

function pidFilePath(sessionKey: string): string {
  // sessionKey is a CUID taskId or the assistant key — both filesystem-safe.
  return join(SIGNAL_DIR, `${PID_PREFIX}${sessionKey}`);
}

/** Persist the pid of a freshly spawned session. Fire-and-forget, best-effort. */
export async function recordSessionPid(sessionKey: string, pid: number): Promise<void> {
  try {
    await mkdir(SIGNAL_DIR, { recursive: true, mode: 0o700 });
    await writeFile(pidFilePath(sessionKey), String(pid), { mode: 0o600 });
  } catch {
    // Best-effort — orphan reaping degraded, not fatal
  }
}

/** Drop the pid file on clean session teardown. */
export async function clearSessionPid(sessionKey: string): Promise<void> {
  try {
    await unlink(pidFilePath(sessionKey));
  } catch {
    // Already gone — fine
  }
}

/** True if `pid` is currently alive (signal 0 probes existence without delivering). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it — still alive.
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/** True if the pid's command line looks like a CLI Tower spawned. */
function isTowerCli(pid: number): boolean {
  try {
    const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (!cmd) return false;
    return CLI_MARKERS.some((m) => cmd.includes(m));
  } catch {
    // ps unavailable / pid vanished — fail closed (do not kill)
    return false;
  }
}

/**
 * Reap orphaned session process groups left by a previous Tower run.
 * Returns the number of groups killed (for logging/tests).
 */
export async function reapOrphanedProcesses(): Promise<number> {
  let files: string[];
  try {
    files = await readdir(SIGNAL_DIR);
  } catch {
    return 0; // dir doesn't exist yet — nothing to reap
  }

  let killed = 0;
  for (const name of files) {
    if (!name.startsWith(PID_PREFIX)) continue;
    const filePath = join(SIGNAL_DIR, name);

    let pid: number;
    try {
      pid = parseInt((await readFile(filePath, "utf-8")).trim(), 10);
    } catch {
      continue;
    }

    // Always drop the file — it represents a session that didn't clean up.
    await unlink(filePath).catch(() => {});

    if (!Number.isInteger(pid) || pid <= 1) continue;
    if (!isAlive(pid)) continue;

    // Windows has no POSIX process groups; skip group reaping there.
    if (process.platform === "win32") continue;

    // Identity gate: only kill if it's still a CLI we spawned (guards pid reuse).
    if (!isTowerCli(pid)) continue;

    try {
      process.kill(-pid, "SIGKILL"); // negative pid → whole process group
      killed++;
    } catch {
      // Already gone or not permitted — ignore
    }
  }
  return killed;
}
