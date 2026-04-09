"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: string;
  onSessionEnd?: (exitCode: number) => void;
}

type WsStatus = "connecting" | "connected" | "disconnected";

// Theme extracted from user's iTerm2 profile (Ayu Dark)
const DARK_THEME = {
  background: "#0f1419",
  foreground: "#e6e1cf",
  cursor: "#f29718",
  cursorAccent: "#e6e1cf",
  selectionBackground: "#f8f8f826",
  selectionForeground: "#eaeaea",
  black: "#000000",
  red: "#ff3333",
  green: "#b8cc52",
  yellow: "#e7c547",
  blue: "#36a3d9",
  magenta: "#f07178",
  cyan: "#95e6cb",
  white: "#ffffff",
  brightBlack: "#323232",
  brightRed: "#ff6565",
  brightGreen: "#eafe84",
  brightYellow: "#fff779",
  brightBlue: "#68d5ff",
  brightMagenta: "#ffa3aa",
  brightCyan: "#c7fffd",
  brightWhite: "#ffffff",
};

export default function TerminalView({ sessionId, onSessionEnd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");

  const onSessionEndRef = useRef(onSessionEnd);
  onSessionEndRef.current = onSessionEnd;

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.35,
      letterSpacing: 0.5,
      scrollback: 10000,
      cursorBlink: true,
      cursorStyle: "bar",
      theme: DARK_THEME,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    // GPU-accelerated rendering
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      terminal.loadAddon(webglAddon);
    } catch {
      // canvas fallback
    }

    fitAddon.fit();
    terminal.focus();

    const wsUrl = `ws://localhost:3001/terminal?taskId=${encodeURIComponent(sessionId)}`;
    setStatus("connecting");
    const ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      terminal.focus();
      setStatus("connected");
    });

    // Output: WS → terminal
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

    ws.addEventListener("close", (event) => {
      setStatus("disconnected");
      if (event.code >= 4000) {
        onSessionEndRef.current?.(event.code - 4000);
      }
    });

    ws.addEventListener("error", () => {
      setStatus("disconnected");
    });

    const el = containerRef.current;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
        }
      }, 100);
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      fitAddon.dispose();
      terminal.dispose();
      ws.close();
    };
  }, [sessionId]);

  const statusDot =
    status === "connected" ? "bg-emerald-400"
      : status === "connecting" ? "bg-yellow-400 animate-pulse"
        : "bg-red-400";

  const statusLabel =
    status === "connected" ? "Connected"
      : status === "connecting" ? "Connecting..."
        : "Disconnected";

  return (
    <div className="relative h-full w-full" style={{ background: DARK_THEME.background }}>
      {/* Status badge — top-right, fades out when connected */}
      <div
        className={`absolute right-3 top-2 z-10 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide transition-opacity duration-700 ${
          status === "connected" ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
        style={{ background: "rgba(30,30,46,0.85)", backdropFilter: "blur(8px)" }}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
        <span style={{ color: DARK_THEME.foreground }}>{statusLabel}</span>
      </div>

      {/* xterm.js container */}
      <div ref={containerRef} className="h-full w-full p-1" />
    </div>
  );
}
