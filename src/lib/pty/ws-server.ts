import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { getSession, destroySession } from "./session-store";

// D-11: CSWSH prevention — only localhost origins are allowed
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

// D-14: 30-second keepalive window before PTY is destroyed on WS disconnect
const DISCONNECT_TIMEOUT_MS = 30_000;

// Track active WS client per task for sending session_end events
const sessionClients = new Map<string, WebSocket>();

// D-15: Batch PTY output with 8ms window to avoid flooding the WS send buffer
const BATCH_INTERVAL_MS = 8;

// D-15: Flood guard — don't write if the WS send buffer exceeds 64 KB
const SEND_BUFFER_MAX = 64 * 1024;

/**
 * WS-01: Start the WebSocket server on port 3001.
 *
 * Uses `noServer: true` + an HTTP wrapper so the upgrade handler can reject
 * cross-origin connections with a proper HTTP 403 response before the WS
 * handshake completes.
 */
const g = globalThis as typeof globalThis & { __wsServerStarted?: boolean };

export async function startWsServer(): Promise<void> {
  // Singleton guard — prevent EADDRINUSE on HMR/config restarts
  if (g.__wsServerStarted) return;
  g.__wsServerStarted = true;
  const httpServer = http.createServer((_req, res) => {
    res.writeHead(426, { "Content-Type": "text/plain" });
    res.end("WebSocket upgrade required");
  });

  const wss = new WebSocketServer({ noServer: true });

  // D-11: Validate origin at the HTTP upgrade stage so we can return 403
  httpServer.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin ?? "";
    if (!ALLOWED_ORIGINS.has(origin)) {
      console.error(`[ws-server] Rejected origin: ${origin || "(none)"}`);
      socket.write(
        "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nForbidden"
      );
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", handleConnection);

  await new Promise<void>((resolve) => {
    httpServer.listen(3001, () => {
      console.error("[ws-server] WebSocket server listening on port 3001");
      resolve();
    });
  });
}

/** Wire a PTY session to a WebSocket client — shared by initial connect + poll-wait paths */
function wireSession(session: import("./pty-session").PtySession, ws: WebSocket, taskId: string): void {
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
  }
  session.setDataListener(makeBatchedSender(ws));
  sessionClients.set(taskId, ws);
  const buffer = session.getBuffer();
  if (buffer && ws.readyState === WebSocket.OPEN) {
    ws.send(buffer);
  }
  // Signal session end via WS close code (4000+exitCode) — not JSON text frame.
  // AttachAddon would render JSON as garbage in terminal if sent as a message.
  session.addExitListener((exitCode) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(4000 + exitCode, "session_end");
    }
  });
}

/**
 * Handle a new WebSocket connection.
 */
function handleConnection(ws: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url ?? "/", "http://localhost:3001");
  const taskId = url.searchParams.get("taskId");

  if (!taskId) {
    console.error("[ws-server] Connection rejected: missing taskId");
    ws.close(1008, "Missing taskId");
    return;
  }

  console.error(`[ws-server] Connection for task ${taskId}`);

  // Check for an existing session — this is the reconnect path (WS-03)
  let session = getSession(taskId);

  if (session) {
    wireSession(session, ws, taskId);
    console.error(`[ws-server] Attached to existing session for task ${taskId}`);
  } else {
    // No session yet — wait for startPtyExecution to create it (polls every 500ms, max 30s)
    console.error(`[ws-server] No session for task ${taskId} — waiting for creation...`);
    let waited = 0;
    const POLL_MS = 500;
    const MAX_WAIT_MS = 30_000;
    const pollTimer = setInterval(() => {
      waited += POLL_MS;
      session = getSession(taskId);
      if (session) {
        clearInterval(pollTimer);
        wireSession(session, ws, taskId);
        console.error(`[ws-server] Session appeared for task ${taskId} after ${waited}ms`);
      } else if (waited >= MAX_WAIT_MS || ws.readyState !== WebSocket.OPEN) {
        clearInterval(pollTimer);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1008, "No PTY session created within timeout.");
        }
      }
    }, POLL_MS);
    // Still set up message/close handlers below — they'll work once session is wired
  }

  // D-12 / D-13: WS → PTY: forward input; detect resize JSON
  ws.on("message", (rawData) => {
    // Guard: session may not exist yet during poll-wait phase
    if (!session) return;
    const data = rawData.toString();
    // D-13: Resize messages arrive as JSON starting with "{"
    if (data.startsWith("{")) {
      try {
        const msg = JSON.parse(data) as {
          type?: string;
          cols?: number;
          rows?: number;
        };
        if (
          msg.type === "resize" &&
          typeof msg.cols === "number" &&
          typeof msg.rows === "number"
        ) {
          session.resize(msg.cols, msg.rows);
          return;
        }
      } catch {
        // Not valid JSON — treat as regular terminal input
      }
    }
    session.write(data);
  });

  // D-14: WS disconnect → start 30s keepalive timer, do NOT kill PTY
  ws.on("close", () => {
    console.error(
      `[ws-server] WS disconnected for task ${taskId} — starting ${DISCONNECT_TIMEOUT_MS}ms keepalive timer`
    );
    const s = getSession(taskId);
    if (!s || s.killed) return;
    // Reset data listener to no-op so PTY output during keepalive window is discarded
    s.setDataListener(() => {});
    s.disconnectTimer = setTimeout(() => {
      console.error(
        `[ws-server] Keepalive expired for task ${taskId} — destroying session`
      );
      destroySession(taskId);
    }, DISCONNECT_TIMEOUT_MS);
  });

  ws.on("error", (err) => {
    console.error(
      `[ws-server] WS error for task ${taskId}:`,
      err.message
    );
    // Reset data listener to no-op on error to prevent writes to a broken socket
    const s = getSession(taskId);
    if (s && !s.killed) {
      s.setDataListener(() => {});
    }
  });
}

/**
 * D-15: Returns an onData callback that batches PTY output over an 8ms window
 * and skips the send if the WS buffer exceeds 64 KB (flood guard).
 */
function makeBatchedSender(ws: WebSocket): (data: string) => void {
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (data: string) => {
    pending += data;
    if (timer) return; // already scheduled
    timer = setTimeout(() => {
      timer = null;
      if (
        ws.readyState === WebSocket.OPEN &&
        ws.bufferedAmount < SEND_BUFFER_MAX
      ) {
        ws.send(pending);
      }
      pending = "";
    }, BATCH_INTERVAL_MS);
  };
}
