import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { getSession, destroySession } from "./session-store";
import { readConfigValue } from "@/lib/config-reader";
import { ASSISTANT_SESSION_KEY } from "@/lib/assistant-constants";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

// Keepalive: how long a PTY session survives after WS disconnect.
// Process still running → 2 hours (user may switch tasks, take a break).
// Process already exited → 5 minutes (just preserving output buffer for review).
const KEEPALIVE_RUNNING_MS = 2 * 60 * 60 * 1000; // 2 hours
const KEEPALIVE_EXITED_MS = 5 * 60 * 1000;        // 5 minutes
const sessionClients = new Map<string, WebSocket>();
const BATCH_INTERVAL_MS = 8;
const SEND_BUFFER_MAX = 64 * 1024;

const g = globalThis as typeof globalThis & { __wss?: InstanceType<typeof WebSocketServer> };

export async function startWsServer(): Promise<void> {
  // Close previous server on HMR reload so fresh code always takes effect
  if (g.__wss) {
    g.__wss.close();
    g.__wss = undefined;
    await new Promise((r) => setTimeout(r, 200));
  }

  const wsPort = await readConfigValue<number>("terminal.wsPort", 3001);
  const wss = new WebSocketServer({ port: wsPort, host: "127.0.0.1", perMessageDeflate: false });
  g.__wss = wss;
  console.error(`[ws-server] WebSocket server listening on port ${wsPort}`);

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const origin = req.headers.origin ?? "";
    if (!ALLOWED_ORIGINS.has(origin)) {
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

    // Security: __assistant__ is a deliberate exception to the CUID taskId convention.
    // The assistant session uses a fixed key (not a CUID) because it has no TaskExecution
    // DB row. Origin checking (ALLOWED_ORIGINS above) mitigates cross-origin access.
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

      if (sessionClients.get(taskId) !== ws) return;
      console.error(`[ws-server] WS disconnected for task ${taskId}`);
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
      if (sessionClients.get(taskId) !== ws) return;
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
  const batcher = makeBatchedSender(ws);
  session.setDataListener(batcher.send);
  // Store batcher so close handler can flush pending data
  (ws as WebSocket & { _batcher?: BatchedSender })._batcher = batcher;
  sessionClients.set(taskId, ws);
  const buffer = session.getBuffer();
  if (buffer && ws.readyState === WebSocket.OPEN) {
    ws.send(buffer);
  }
  session.setExitListener((exitCode: number) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(4000 + exitCode, "session_end");
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
