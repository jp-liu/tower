import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getSignalDir } from "@/lib/tower-dir";

/**
 * Unattended-mode signal file, read by the PreToolUse hook to decide whether a
 * terminal is watched. Lives next to the exit-signal / orphan-reaper pid files
 * in getSignalDir() (0700 dir, 0600 file per security rules). The DB
 * `task.unattended` column stays the source of truth for harness scope; this
 * file mirrors it so the standalone hook (which has no DB access) can read it.
 * Both the MCP process (set_goal_mode) and the server (status transitions) call
 * this — getSignalDir() resolves the same path in either since TOWER_DATA_DIR is
 * pinned consistently across both.
 */
function unattendedFile(taskId: string): string {
  return join(getSignalDir(), `unattended-${taskId}`);
}

/** Mirror the task's unattended flag to its signal file (write on, remove off). */
export function setUnattendedSignal(taskId: string, on: boolean): void {
  try {
    if (on) {
      mkdirSync(getSignalDir(), { recursive: true, mode: 0o700 });
      writeFileSync(unattendedFile(taskId), "1", { mode: 0o600 });
    } else {
      rmSync(unattendedFile(taskId), { force: true });
    }
  } catch {
    // Best-effort — a missing signal file just means the hook treats the run as
    // attended (fail-open); never let a signal write break goal-mode toggling.
  }
}
