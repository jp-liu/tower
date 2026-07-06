import { PreviewSession, type PreviewSessionOpts } from "./preview-session";

declare global {
  // eslint-disable-next-line no-var
  var __previewSignalHandlersRegistered: boolean | undefined;
  // eslint-disable-next-line no-var
  var __previewSessions: Map<string, PreviewSession> | undefined;
  // eslint-disable-next-line no-var
  var __previewSweepStarted: boolean | undefined;
}

// A dead, unwatched preview session lingers in the Map with its ~1MB ring buffer
// (dev servers exit / error, or you preview many worktrees over one session). Sweep
// it after a grace window so a viewer reopening within the window still sees the
// final logs, but long-idle corpses don't accumulate. Running/watched sessions are
// never touched (isEvictable is false for them).
const PREVIEW_EVICT_GRACE_MS = 5 * 60 * 1000; // keep dead session ~5min for late reopen
const PREVIEW_SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Pure eviction decision (unit-tested): a key expires once it has been
 * continuously evictable for at least `graceMs`. Mutates `seenAt` to record/clear
 * the first-seen-evictable timestamp per key. Returns the keys to destroy now.
 */
export function selectExpiredPreviewKeys(
  entries: Array<{ key: string; evictable: boolean }>,
  seenAt: Map<string, number>,
  now: number,
  graceMs: number
): string[] {
  const expired: string[] = [];
  for (const { key, evictable } of entries) {
    if (!evictable) {
      seenAt.delete(key);
      continue;
    }
    const since = seenAt.get(key);
    if (since === undefined) {
      seenAt.set(key, now);
      continue;
    }
    if (now - since >= graceMs) expired.push(key);
  }
  return expired;
}

// HMR-safe singleton：Next.js dev 模式会重求值模块。
// 把 sessions 挂在 globalThis 上，SIGTERM 钩子才能访问当前 Map（不被旧模块孤儿化）。
const sessions: Map<string, PreviewSession> = (globalThis.__previewSessions ??= new Map());

export function getOrCreatePreviewSession(
  key: string,
  opts: Omit<PreviewSessionOpts, "key">
): PreviewSession {
  let s = sessions.get(key);
  if (!s) {
    s = new PreviewSession({ ...opts, key });
    sessions.set(key, s);
  }
  return s;
}

export function getPreviewSession(key: string): PreviewSession | undefined {
  return sessions.get(key);
}

export function destroyPreviewSession(key: string): void {
  const s = sessions.get(key);
  if (!s) return;
  try {
    s.stop();
  } catch {
    // ignore
  }
  sessions.delete(key);
}

export function destroyAllPreviewSessions(): void {
  for (const key of [...sessions.keys()]) {
    destroyPreviewSession(key);
  }
}

if (!globalThis.__previewSignalHandlersRegistered) {
  process.on("SIGTERM", destroyAllPreviewSessions);
  process.on("SIGINT", destroyAllPreviewSessions);
  process.on("SIGHUP", destroyAllPreviewSessions);
  globalThis.__previewSignalHandlersRegistered = true;
}

// Periodic eviction of dead, unwatched preview sessions (see PREVIEW_EVICT_GRACE_MS).
// globalThis flag prevents duplicate intervals across HMR re-evaluation; unref so it
// never keeps the event loop alive. Skipped during production build.
if (
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !globalThis.__previewSweepStarted
) {
  globalThis.__previewSweepStarted = true;
  const seenAt = new Map<string, number>();
  const timer = setInterval(() => {
    const now = Date.now();
    const entries = [...sessions].map(([key, s]) => ({ key, evictable: s.isEvictable }));
    for (const key of selectExpiredPreviewKeys(entries, seenAt, now, PREVIEW_EVICT_GRACE_MS)) {
      destroyPreviewSession(key);
      seenAt.delete(key);
    }
  }, PREVIEW_SWEEP_INTERVAL_MS);
  timer.unref?.();
}
