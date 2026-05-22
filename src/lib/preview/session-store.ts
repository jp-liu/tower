import { PreviewSession, type PreviewSessionOpts } from "./preview-session";

declare global {
  // eslint-disable-next-line no-var
  var __previewSignalHandlersRegistered: boolean | undefined;
  // eslint-disable-next-line no-var
  var __previewSessions: Map<string, PreviewSession> | undefined;
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
