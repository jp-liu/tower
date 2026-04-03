"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { AttachAddon } from "@xterm/addon-attach";
import { WebglAddon } from "@xterm/addon-webgl";
import { useTheme } from "next-themes";
import { useI18n } from "@/lib/i18n";
import "@xterm/xterm/css/xterm.css";

export interface TaskTerminalProps {
  taskId: string;
  worktreePath?: string | null;
  onSessionEnd?: (exitCode: number) => void;
}

// Local debounce implementation — no lodash dependency
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

type WsStatus = "connecting" | "connected" | "disconnected";

/**
 * TaskTerminal — xterm.js browser terminal connected to Phase 24 WebSocket PTY server.
 *
 * IMPORTANT: This component accesses `window` at import time via @xterm/xterm.
 * Always load via `next/dynamic({ ssr: false })`:
 *
 *   const TaskTerminal = dynamic(
 *     () => import("@/components/task/task-terminal").then(m => ({ default: m.TaskTerminal })),
 *     { ssr: false }
 *   );
 */
export function TaskTerminal({
  taskId,
  worktreePath,
  onSessionEnd,
}: TaskTerminalProps) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const onSessionEndRef = useRef(onSessionEnd);
  onSessionEndRef.current = onSessionEnd;

  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [connectedVisible, setConnectedVisible] = useState(false);

  // Mount effect: create terminal + WebSocket connection
  // Skipped entirely when no worktreePath (placeholder rendered instead)
  useEffect(() => {
    if (!worktreePath || !containerRef.current) return;

    const isDark = resolvedTheme !== "light";
    const initialTheme = isDark
      ? { background: "#0a0a0a", foreground: "#e5e5e5" }
      : { background: "#fafafa", foreground: "#171717" };

    // 1. Create terminal
    const terminal = new Terminal({
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      scrollback: 5000,
      cursorBlink: true,
      allowTransparency: false,
      theme: initialTheme,
    });

    // 2. Create and load FitAddon
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // 3. Open terminal in DOM — must happen before fitAddon.fit()
    terminal.open(containerRef.current);

    // 4. Attempt WebGL addon (GPU-accelerated renderer)
    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available — fall back to canvas renderer silently
    }

    // 5. Initial fit
    fitAddon.fit();

    // 6. Create WebSocket
    setWsStatus("connecting");
    const ws = new WebSocket(
      `ws://localhost:3001/terminal?taskId=${encodeURIComponent(taskId)}`
    );

    // 7. On WS open: send initial resize + load AttachAddon
    let attachAddon: AttachAddon | null = null;
    ws.addEventListener("open", () => {
      // Send initial PTY size
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        })
      );

      // Intercept session_end messages before AttachAddon processes them
      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "session_end" && typeof msg.exitCode === "number") {
              onSessionEndRef.current?.(msg.exitCode);
            }
          } catch {
            // Not JSON — let AttachAddon handle it
          }
        }
      });

      // 8. AttachAddon handles bidirectional piping:
      //    ws.onmessage → terminal.write (TERM-01: ANSI rendering)
      //    terminal.onData → ws.send (TERM-02: keyboard input)
      attachAddon = new AttachAddon(ws, { bidirectional: true });
      terminal.loadAddon(attachAddon);

      setWsStatus("connected");
      setConnectedVisible(true);
      setTimeout(() => setConnectedVisible(false), 2000);
    });

    ws.addEventListener("close", () => {
      setWsStatus("disconnected");
    });

    ws.addEventListener("error", () => {
      setWsStatus("disconnected");
    });

    // Store refs for ResizeObserver and theme effects
    terminalRef.current = terminal;
    wsRef.current = ws;
    fitAddonRef.current = fitAddon;

    // Cleanup in reverse load order
    return () => {
      attachAddon?.dispose();
      webglAddon?.dispose();
      fitAddon.dispose();
      terminal.dispose();
      ws.close();
      terminalRef.current = null;
      wsRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, worktreePath]);

  // Resize effect: ResizeObserver + 100ms debounce (TERM-03)
  useEffect(() => {
    if (!worktreePath || !containerRef.current) return;

    const debouncedResize = debounce(() => {
      const fit = fitAddonRef.current;
      const ws = wsRef.current;
      const term = terminalRef.current;
      if (!fit || !term) return;
      fit.fit();
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })
        );
      }
    }, 100);

    const el = containerRef.current;
    const resizeObserver = new ResizeObserver(debouncedResize);
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
    };
  }, [worktreePath]);

  // Theme effect: update terminal colors on dark/light toggle (TERM-04)
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    const isDark = resolvedTheme !== "light";
    term.options.theme = isDark
      ? { background: "#0a0a0a", foreground: "#e5e5e5" }
      : { background: "#fafafa", foreground: "#171717" };
  }, [resolvedTheme]);

  // No-worktree placeholder
  if (!worktreePath) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#0a0a0a] text-center">
        <p className="text-sm text-neutral-400">{t("terminal.noWorktree")}</p>
        <p className="text-xs text-neutral-600 mt-1">
          {t("terminal.noWorktreeDesc")}
        </p>
      </div>
    );
  }

  // Status indicator values
  const statusColor =
    wsStatus === "connected"
      ? "bg-green-500"
      : wsStatus === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";

  const statusLabel =
    wsStatus === "connected"
      ? t("terminal.connected")
      : wsStatus === "connecting"
        ? t("terminal.connecting")
        : t("terminal.disconnected");

  return (
    <div className="relative h-full w-full bg-[#0a0a0a]">
      {/* Connection status indicator — top-right corner */}
      <div
        className={[
          "absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-opacity duration-500",
          wsStatus === "connected" && !connectedVisible
            ? "opacity-0 pointer-events-none"
            : "opacity-100",
          "bg-black/40 backdrop-blur-sm",
        ].join(" ")}
        title={statusLabel}
      >
        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
        <span className="text-neutral-300">{statusLabel}</span>
      </div>

      {/* xterm.js container — xterm manages the canvas element inside this div */}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
