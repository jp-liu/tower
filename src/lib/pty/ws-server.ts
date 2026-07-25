import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { getSession, destroySession } from "./session-store";
import { stripDeviceQueries } from "./strip-device-queries";
import { readConfigValue } from "@/lib/config-reader";
import { ASSISTANT_SESSION_KEY } from "@/lib/assistant-constants";
import { getPreviewSession } from "@/lib/preview/session-store";

function runtimeHost(): string {
  const host = (process.env.TOWER_RUNTIME_HOST || "127.0.0.1").trim();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function headerHostname(value: string): string | null {
  try {
    return new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

export function isAllowedWsOrigin(
  origin: string,
  requestHost: string,
  configuredHost = runtimeHost(),
  httpPort = parseInt(process.env.PORT || "3000", 10),
): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" || Number(parsed.port || "80") !== httpPort) return false;
    const originHost = parsed.hostname.replace(/^\[|\]$/g, "");
    if (["localhost", "127.0.0.1", "::1"].includes(originHost)) return true;
    if (["0.0.0.0", "::"].includes(configuredHost)) {
      return originHost === headerHostname(requestHost);
    }
    return originHost === configuredHost;
  } catch {
    return false;
  }
}

// Keepalive: how long a PTY session survives after WS disconnect.
// Process still running → 2 hours (user may switch tasks, take a break).
// Process already exited → 5 minutes (just preserving output buffer for review).
const KEEPALIVE_RUNNING_MS = 2 * 60 * 60 * 1000; // 2 hours
const KEEPALIVE_EXITED_MS = 5 * 60 * 1000;        // 5 minutes

// Multicast: multiple WS clients can connect to the same PTY session
// (e.g. task detail panel + Mission Control viewing the same task)
const sessionClients = new Map<string, Set<WebSocket>>();

// Global notification channel — clients connected with taskId=__notifications__.
// The client Set lives on globalThis (see getNotificationClients below) so that
// the WS server module instance and any separately-loaded module instance
// (standalone builds load ws-server twice: once for the WS server, once inside
// the API route bundle) share ONE registry. Mirrors globalThis.__previewSessions.
const NOTIFICATION_CHANNEL = "__notifications__";

function getNotificationClients(): Set<WebSocket> {
  if (!g.__notificationClients) {
    g.__notificationClients = new Set<WebSocket>();
  }
  return g.__notificationClients;
}

/** Register a notification client (called by the WS connection handler). */
export function addNotificationClient(ws: WebSocket): void {
  getNotificationClients().add(ws);
}

/** Unregister a notification client (on WS close/error). */
export function removeNotificationClient(ws: WebSocket): void {
  getNotificationClients().delete(ws);
}

// PREVIEW_TASK_ID / parsePreviewWsParams / PreviewWsParams live in a separate
// module so client bundles can import them without dragging node-pty into the
// browser build. Re-export here so existing server callers (and tests) keep working.
export { PREVIEW_TASK_ID, parsePreviewWsParams, type PreviewWsParams } from "@/lib/preview/ws-constants";
import { parsePreviewWsParams } from "@/lib/preview/ws-constants";

/**
 * Broadcast a JSON message to all connected notification clients.
 * Called from API routes (e.g. Stop hook) to push events to the browser.
 */
export function broadcastNotification(payload: object): void {
  const msg = JSON.stringify(payload);
  for (const client of getNotificationClients()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

const BATCH_INTERVAL_MS = 8;
const SEND_BUFFER_MAX = 64 * 1024;

const WS_PTY_EXIT_BASE = 4000; // 4000–4255: PTY 退出码 0–255 嵌入 WebSocket 关闭码（RFC 允许 1000–4999）
const WS_PTY_UNKNOWN_EXIT = WS_PTY_EXIT_BASE + 255;

/**
 * node-pty 在进程被信号终止时 `exitCode` 可能为 `undefined`；Windows 上可能是大于 256 的 32 位无符号数。
 * `client.close(4000 + undefined)` 会得到 NaN 并抛错。归一化到 0–255 再 +4000。
 */
function webSocketCloseCodeForPtyExit(exitCode: number | null | undefined): number {
  if (exitCode == null) {
    return WS_PTY_UNKNOWN_EXIT;
  }
  const n = Number(exitCode);
  if (!Number.isFinite(n)) {
    return WS_PTY_UNKNOWN_EXIT;
  }
  // 0–255 原样；否则取低 8 位（Windows 崩溃码 HRESULT 等）
  const b = n >= 0 && n < 256 ? n | 0 : (n >>> 0) & 0xff;
  const code = WS_PTY_EXIT_BASE + b;
  // `ws` 要求关闭码在合法数值范围内
  if (code < 1000 || code > 4999) {
    return WS_PTY_UNKNOWN_EXIT;
  }
  return code;
}

function isPortInUse(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const { createServer } = require("net") as typeof import("net");
    const tester = createServer();
    tester.once("error", () => resolve(true));
    tester.once("listening", () => { tester.close(() => resolve(false)); });
    tester.listen(port, host);
  });
}

const g = globalThis as typeof globalThis & {
  __wss?: InstanceType<typeof WebSocketServer>;
  __wsPort?: number;
  __notificationClients?: Set<WebSocket>;
};

/** Get the actual WebSocket port the server is listening on. */
export function getActiveWsPort(): number | null {
  return g.__wsPort ?? null;
}

export async function startWsServer(): Promise<void> {
  // Close previous server on HMR reload so fresh code always takes effect
  if (g.__wss) {
    const prev = g.__wss;
    g.__wss = undefined;
    await new Promise<void>((resolve) => {
      prev.close(() => resolve());
      // Fallback timeout in case close callback never fires
      setTimeout(resolve, 1000);
    });
  }

  const httpPort = parseInt(process.env.PORT || "3000", 10);
  const host = runtimeHost();
  const defaultWsPort = httpPort + 1;
  const preferredPort = await readConfigValue<number>("terminal.wsPort", defaultWsPort);

  // Try preferred port, then increment up to 10 times to find a free one
  const MAX_RETRIES = 10;
  let wsPort = preferredPort;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const inUse = await isPortInUse(wsPort, host);
    if (!inUse) break;
    if (attempt === MAX_RETRIES - 1) {
      console.error(`[ws-server] No free port found after trying ${preferredPort}–${wsPort} — skipping startup`);
      return;
    }
    console.error(`[ws-server] Port ${wsPort} in use, trying ${wsPort + 1}...`);
    wsPort++;
  }

  const wss = new WebSocketServer({ port: wsPort, host, perMessageDeflate: false });
  g.__wss = wss;
  g.__wsPort = wsPort;
  if (wsPort !== preferredPort) {
    console.error(`[ws-server] WebSocket server listening on port ${wsPort} (preferred ${preferredPort} was occupied)`);
  } else {
    console.error(`[ws-server] WebSocket server listening on port ${wsPort}`);
  }

  // Close WS server on SIGINT (Ctrl+C) to release port
  const closeWss = () => {
    wss.close();
    g.__wss = undefined;
    g.__wsPort = undefined;
  };
  // Use once() to prevent listener accumulation across HMR reloads
  process.once("SIGINT", closeWss);
  process.once("SIGTERM", closeWss);

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const origin = req.headers.origin ?? "";
    if (!isAllowedWsOrigin(origin, req.headers.host ?? "", host, httpPort)) {
      console.error(`[ws-server] Rejected origin: ${origin || "(none)"}`);
      ws.close(1008, "Forbidden");
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost:${wsPort}`);
    const taskId = url.searchParams.get("taskId");

    if (!taskId) {
      ws.close(1008, "Missing taskId");
      return;
    }

    // Preview channel — dispatch by special taskId "__preview__" + role query
    const previewParams = parsePreviewWsParams(url.searchParams);
    if (previewParams) {
      let session = getPreviewSession(previewParams.previewKey);
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let unsub: (() => void) | null = null;

      function wirePreviewSession(): void {
        if (!session) return;
        unsub = session.subscribe(
          previewParams!.connectionId,
          previewParams!.taskId ?? "unknown",
          (state) => {
            if (previewParams!.role === "state") {
              try {
                ws.send(JSON.stringify({ type: "state", previewKey: session!.key, state }));
              } catch { /* best-effort */ }
            }
          },
          (data) => {
            if (previewParams!.role === "terminal") {
              try { ws.send(data); } catch { /* best-effort */ }
            }
          }
        );
        if (previewParams!.role === "terminal") {
          const buf = session.getBuffer();
          if (buf.length > 0) {
            try { ws.send(buf.join("\n") + "\n"); } catch { /* ignore */ }
          }
        }
        if (previewParams!.role === "state") {
          try {
            ws.send(JSON.stringify({ type: "state", previewKey: session!.key, state: session!.getState() }));
          } catch { /* ignore */ }
        }
      }

      if (session) {
        wirePreviewSession();
      } else {
        // Session not yet created (user hasn't clicked Run) — poll every 500ms for up to 30s,
        // mirroring the Claude PTY poll pattern at line 243.
        let waited = 0;
        pollTimer = setInterval(() => {
          waited += 500;
          session = getPreviewSession(previewParams!.previewKey);
          if (session) {
            clearInterval(pollTimer!);
            pollTimer = null;
            wirePreviewSession();
          } else if (waited >= 30_000 || ws.readyState !== WebSocket.OPEN) {
            clearInterval(pollTimer!);
            pollTimer = null;
            if (ws.readyState === WebSocket.OPEN) {
              ws.close(1008, "No preview session created within timeout.");
            }
          }
        }, 500);
      }

      ws.on("close", () => {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (unsub) { unsub(); unsub = null; }
      });
      ws.on("error", () => {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (unsub) { unsub(); unsub = null; }
      });
      return;  // ⚠ early return to prevent falling into Claude PTY logic
    }

    // Notification channel — lightweight listener for global events (stop, completion)
    if (taskId === NOTIFICATION_CHANNEL) {
      addNotificationClient(ws);
      ws.on("close", () => removeNotificationClient(ws));
      ws.on("error", () => removeNotificationClient(ws));
      return;
    }

    // Security: __assistant__ is a deliberate exception to the CUID taskId convention.
    // The assistant session uses a fixed key (not a CUID) because it has no TaskExecution
    // DB row. Origin checking (getAllowedOrigins() above) mitigates cross-origin access.
    // Non-existent session keys simply time out after 30s (poll loop below).

    console.error(`[ws-server] Connection for task ${taskId}`);

    let session = getSession(taskId);
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    if (session) {
      wireSession(session, ws, taskId);
      console.error(`[ws-server] Attached to existing session for task ${taskId}`);
    } else {
      console.error(`[ws-server] No session for task ${taskId} — polling...`);
      let waited = 0;
      pollTimer = setInterval(() => {
        waited += 500;
        session = getSession(taskId);
        if (session) {
          clearInterval(pollTimer!); pollTimer = null;
          wireSession(session, ws, taskId);
          console.error(`[ws-server] Session appeared for task ${taskId} after ${waited}ms`);
        } else if (waited >= 30_000 || ws.readyState !== WebSocket.OPEN) {
          clearInterval(pollTimer!); pollTimer = null;
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1008, "No PTY session created within timeout.");
          }
        }
      }, 500);
    }

    ws.on("message", (rawData) => {
      if (!session) return;
      const data = rawData.toString();
      if (data.startsWith("{")) {
        try {
          const msg = JSON.parse(data) as { type?: string; cols?: number; rows?: number };
          if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
            session.resize(msg.cols, msg.rows);
            return;
          }
        } catch { /* not JSON */ }
      }
      session.write(data);
    });

    ws.on("close", () => {
      // Flush any pending batched data
      (ws as WebSocket & { _batcher?: BatchedSender })._batcher?.flush();

      const clients = sessionClients.get(taskId);
      if (!clients?.has(ws)) return;
      clients.delete(ws);
      console.error(`[ws-server] WS disconnected for task ${taskId} (${clients.size} remaining)`);

      // If other clients still connected, keep session alive
      if (clients.size > 0) return;

      sessionClients.delete(taskId);
      const s = getSession(taskId);
      if (!s) return;
      s.setDataListener(() => {});

      // Assistant sessions: stateless — destroy immediately on disconnect (BE-05)
      if (taskId === ASSISTANT_SESSION_KEY) {
        console.error(`[ws-server] Assistant session disconnected — destroying immediately`);
        destroySession(taskId);
        return;
      }

      // Parked waiting for a human reply (ask_human) → keep the PTY alive
      // indefinitely so the reply injects into this same live session. Normal
      // keepalive resumes once unparkSession clears the flag (on reply).
      if (s.parked && !s.killed) {
        console.error(`[ws-server] Task ${taskId} parked (ask_human) — keepalive suspended, PTY kept alive`);
        return;
      }

      const timeout = s.killed ? KEEPALIVE_EXITED_MS : KEEPALIVE_RUNNING_MS;
      s.disconnectTimer = setTimeout(() => {
        console.error(`[ws-server] Keepalive expired for task ${taskId}`);
        destroySession(taskId);
      }, timeout);
    });

    ws.on("error", (err) => {
      console.error(`[ws-server] WS error for task ${taskId}:`, err.message);
      // Clear polling timer if still active
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      const clients = sessionClients.get(taskId);
      if (!clients?.has(ws)) return;
      clients.delete(ws);
      if (clients.size > 0) return;
      sessionClients.delete(taskId);
      const s = getSession(taskId);
      if (s && !s.killed) s.setDataListener(() => {});
    });
  });
}

function wireSession(session: import("./pty-session").PtySession, ws: WebSocket, taskId: string): void {
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
  }

  // Add this WS to the client set
  let clients = sessionClients.get(taskId);
  if (!clients) {
    clients = new Set();
    sessionClients.set(taskId, clients);
  }
  clients.add(ws);

  // Create batcher for this specific WS client
  const batcher = makeBatchedSender(ws);
  (ws as WebSocket & { _batcher?: BatchedSender })._batcher = batcher;

  // Multicast data listener — broadcasts to ALL connected clients.
  // setDataListener replaces the single listener (last-writer-wins by design).
  // This is safe because `currentClients` captures the shared Set reference:
  // when a new client connects, wireSession re-registers with the same Set,
  // so the new lambda still broadcasts to all clients including earlier ones.
  const currentClients = clients;
  session.setDataListener((data: string) => {
    for (const client of currentClients) {
      const b = (client as WebSocket & { _batcher?: BatchedSender })._batcher;
      if (b) {
        b.send(data);
      } else if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  });

  // Replay buffer for this new client.
  //
  // CRITICAL: strip terminal query/report-request sequences before replay. The raw
  // buffer contains queries the TUI (Claude CLI) emitted earlier (cursor-position
  // reports, Device Attributes, etc.). Replayed verbatim into a fresh xterm, xterm
  // auto-answers each one and the answers loop back through terminal.onData → this
  // server's `session.write()` as phantom PTY input the user never typed — which has
  // been observed to trigger Claude's `/clear` and wipe the session context. Query
  // requests render nothing, so stripping them is visually lossless.
  // See strip-device-queries.ts for the full rationale.
  const buffer = session.getBuffer();
  if (buffer && ws.readyState === WebSocket.OPEN) {
    const safeBuffer = stripDeviceQueries(buffer);
    if (safeBuffer.length !== buffer.length) {
      console.error(
        `[ws-server] Stripped ${buffer.length - safeBuffer.length} bytes of device-query ` +
          `sequences from replay for task ${taskId} (prevents phantom PTY input on reconnect)`
      );
    }
    ws.send(safeBuffer);
  }

  // Set up exit listener — notify ALL connected clients
  session.setExitListener((exitCode) => {
    const closeCode = webSocketCloseCodeForPtyExit(exitCode);
    for (const client of currentClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close(closeCode, "session_end");
      }
    }
  });
}

interface BatchedSender {
  send: (data: string) => void;
  flush: () => void;
}

function makeBatchedSender(ws: WebSocket): BatchedSender {
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pending && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < SEND_BUFFER_MAX) {
      ws.send(pending);
    }
    pending = "";
  };
  const send = (data: string) => {
    pending += data;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < SEND_BUFFER_MAX) {
        ws.send(pending);
      }
      pending = "";
    }, BATCH_INTERVAL_MS);
  };
  return { send, flush };
}
