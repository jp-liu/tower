"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { useTheme } from "next-themes";
import { useI18n } from "@/lib/i18n";
import "@xterm/xterm/css/xterm.css";

export interface TaskTerminalProps {
  taskId: string;
  worktreePath?: string | null;
  onSessionEnd?: (exitCode: number) => void;
}

type WsStatus = "connecting" | "connected" | "disconnected";

/**
 * TaskTerminal — xterm.js browser terminal connected to WebSocket PTY server.
 *
 * Uses manual bidirectional I/O (terminal.onData → ws.send, ws.onmessage → terminal.write)
 * instead of AttachAddon, which has compatibility issues with React Strict Mode.
 *
 * IMPORTANT: This component accesses `window` at import time via @xterm/xterm.
 * Always load via `next/dynamic({ ssr: false })`.
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

  // Stable ref for callback — avoids useEffect re-run on prop change
  const onSessionEndRef = useRef(onSessionEnd);
  onSessionEndRef.current = onSessionEnd;

  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [connectedVisible, setConnectedVisible] = useState(false);

  // Mount effect: create terminal + WebSocket connection
  useEffect(() => {
    if (!worktreePath || !containerRef.current) return;

    const isDark = resolvedTheme !== "light";
    const initialTheme = isDark
      ? { background: "#0a0a0a", foreground: "#e5e5e5" }
      : { background: "#fafafa", foreground: "#171717" };

    const terminal = new Terminal({
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      scrollback: 5000,
      cursorBlink: true,
      allowTransparency: false,
      theme: initialTheme,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    // Attempt WebGL addon (GPU-accelerated renderer)
    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => { webglAddon?.dispose(); });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available — fall back to canvas renderer
    }

    fitAddon.fit();
    terminal.focus();

    // Create WebSocket
    setWsStatus("connecting");
    const ws = new WebSocket(
      `ws://localhost:3001/terminal?taskId=${encodeURIComponent(taskId)}`
    );

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      terminal.focus();
      setWsStatus("connected");
      setConnectedVisible(true);
      setTimeout(() => setConnectedVisible(false), 2000);
    });

    // Output: WS → terminal (replaces AttachAddon for React Strict Mode compat)
    ws.addEventListener("message", (event) => {
      const data = event.data;
      if (typeof data === "string") {
        terminal.write(data);
      } else if (data instanceof Blob) {
        data.text().then((text) => terminal.write(text));
      } else if (data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(data));
      }
    });

    // Input: terminal → WS
    const dataDisposable = terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Session end: WS close code 4000+exitCode
    ws.addEventListener("close", (event) => {
      setWsStatus("disconnected");
      if (event.code >= 4000) {
        onSessionEndRef.current?.(event.code - 4000);
      }
    });

    ws.addEventListener("error", () => {
      setWsStatus("disconnected");
    });

    // Store refs for resize/theme effects
    terminalRef.current = terminal;
    wsRef.current = ws;
    fitAddonRef.current = fitAddon;

    return () => {
      dataDisposable.dispose();
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

  // Resize effect
  useEffect(() => {
    if (!worktreePath || !containerRef.current) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const el = containerRef.current;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const fit = fitAddonRef.current;
        const ws = wsRef.current;
        const term = terminalRef.current;
        if (!fit || !term) return;
        fit.fit();
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      }, 100);
    });
    resizeObserver.observe(el);

    return () => { resizeObserver.disconnect(); };
  }, [worktreePath]);

  // Theme effect
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    const isDark = resolvedTheme !== "light";
    term.options.theme = isDark
      ? { background: "#0a0a0a", foreground: "#e5e5e5" }
      : { background: "#fafafa", foreground: "#171717" };
  }, [resolvedTheme]);

  if (!worktreePath) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#0a0a0a] text-center">
        <p className="text-sm text-neutral-400">{t("terminal.noWorktree")}</p>
        <p className="text-xs text-neutral-600 mt-1">{t("terminal.noWorktreeDesc")}</p>
      </div>
    );
  }

  const statusColor =
    wsStatus === "connected" ? "bg-green-500"
      : wsStatus === "connecting" ? "bg-yellow-500"
        : "bg-red-500";

  const statusLabel =
    wsStatus === "connected" ? t("terminal.connected")
      : wsStatus === "connecting" ? t("terminal.connecting")
        : t("terminal.disconnected");

  return (
    <div className="relative h-full w-full bg-[#0a0a0a]">
      <div
        className={[
          "absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-opacity duration-500",
          wsStatus === "connected" && !connectedVisible ? "opacity-0 pointer-events-none" : "opacity-100",
          "bg-black/40 backdrop-blur-sm",
        ].join(" ")}
        title={statusLabel}
      >
        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
        <span className="text-neutral-300">{statusLabel}</span>
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
