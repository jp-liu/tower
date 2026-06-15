"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { useTheme } from "next-themes";
import { useI18n } from "@/lib/i18n";
import { getActualWsPort, getConfigValues } from "@/actions/config-actions";
import "@xterm/xterm/css/xterm.css";

/** Imperative control handle exposed once the terminal is created/opened. */
export interface TerminalControls {
  focus: () => void;
  blur: () => void;
}

export interface TaskTerminalProps {
  taskId: string;
  worktreePath?: string | null;
  onSessionEnd?: (exitCode: number) => void;
  /** Force canvas renderer instead of WebGL. Use when many terminals coexist (portal system). */
  useCanvasRenderer?: boolean;
  /**
   * Terminal ready/destroy callback exposing imperative controls (null on teardown).
   * Used instead of ref forwarding since this component is loaded via next/dynamic.
   */
  onReady?: (controls: TerminalControls | null) => void;
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
  useCanvasRenderer = false,
  onReady,
}: TaskTerminalProps) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Stable refs for callbacks — avoids useEffect re-run on prop change
  const onSessionEndRef = useRef(onSessionEnd);
  onSessionEndRef.current = onSessionEnd;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

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
      scrollback: 2000,
      cursorBlink: true,
      allowTransparency: false,
      rescaleOverlappingGlyphs: true,
      theme: initialTheme,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    // Ensure the xterm helper textarea stays invisible (CSS may load late in dev)
    const helperTextarea = containerRef.current.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
    if (helperTextarea) {
      helperTextarea.style.opacity = "0";
    }

    // Attempt WebGL addon (GPU-accelerated renderer)
    // Skip WebGL when many terminals may coexist (portal system) —
    // browsers limit WebGL contexts (~8-16), excess causes context loss and blank terminals.
    // Canvas renderer is reliable for any number of terminals.
    let webglAddon: WebglAddon | null = null;
    if (!useCanvasRenderer) {
      try {
        webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon?.dispose();
          webglAddon = null;
        });
        terminal.loadAddon(webglAddon);
      } catch {
        // WebGL not available — fall back to canvas renderer
      }
    }

    fitAddon.fit();
    terminal.focus();

    // Fetch WS port from config, then connect (with auto-reconnect)
    let ws: WebSocket | null = null;
    let dataDisposable: { dispose: () => void } | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let sessionEnded = false;

    // Apply the user-configured terminal font (settings → Terminal), then refit.
    // Created with defaults above; override here so 2K/4K users can size it up.
    getConfigValues(["terminal.fontSize", "terminal.fontFamily"])
      .then((cfg) => {
        if (cancelled) return;
        const fontSize = Number(cfg["terminal.fontSize"]);
        const fontFamily = cfg["terminal.fontFamily"];
        if (Number.isFinite(fontSize) && fontSize > 0) terminal.options.fontSize = fontSize;
        if (typeof fontFamily === "string" && fontFamily.trim()) terminal.options.fontFamily = fontFamily;
        try { fitAddon.fit(); } catch { /* container detaching */ }
      })
      .catch(() => { /* keep defaults */ });

    function connectWs(wsPort: number) {
      if (cancelled || sessionEnded) return;
      setWsStatus("connecting");
      const socket = new WebSocket(
        `ws://localhost:${wsPort}/terminal?taskId=${encodeURIComponent(taskId)}`
      );
      ws = socket;

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
        terminal.focus();
        setWsStatus("connected");
        setConnectedVisible(true);
        setTimeout(() => setConnectedVisible(false), 2000);
      });

      // Output: WS → terminal (replaces AttachAddon for React Strict Mode compat)
      socket.addEventListener("message", (event) => {
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
      dataDisposable?.dispose();
      dataDisposable = terminal.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data);
        }
      });

      // Session end: WS close code 4000+exitCode
      socket.addEventListener("close", (event) => {
        if (event.code >= 4000) {
          // Process exited — don't reconnect
          sessionEnded = true;
          setWsStatus("disconnected");
          onSessionEndRef.current?.(event.code - 4000);
          return;
        }
        setWsStatus("disconnected");
        // Auto-reconnect after 3s (session may still be alive)
        if (!cancelled && !sessionEnded) {
          reconnectTimer = setTimeout(() => connectWs(wsPort), 3000);
        }
      });

      socket.addEventListener("error", () => {
        // error is always followed by close, so reconnect is handled there
      });

      // Store refs for resize/theme effects
      wsRef.current = socket;
    }

    getActualWsPort().then((wsPort) => {
      if (cancelled) return;
      connectWs(wsPort);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Expose imperative controls to parent (callback-prop avoids dynamic ref forwarding).
    onReadyRef.current?.({
      focus: () => terminal.focus(),
      blur: () => terminal.blur(),
    });

    return () => {
      cancelled = true;
      onReadyRef.current?.(null);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      dataDisposable?.dispose();
      webglAddon?.dispose();
      fitAddon.dispose();
      terminal.dispose();
      ws?.close();
      terminalRef.current = null;
      wsRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, worktreePath]);

  // Resize effect — re-runs when taskId changes (portal re-mount to different container)
  useEffect(() => {
    if (!worktreePath || !containerRef.current) return;

    // Initial fit after portal re-mount (e.g. drawer → detail page)
    const fit = fitAddonRef.current;
    const ws = wsRef.current;
    const term = terminalRef.current;
    if (fit && term) {
      // Use rAF to ensure container has its final layout dimensions
      requestAnimationFrame(() => {
        fit.fit();
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      });
    }

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const el = containerRef.current;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const f = fitAddonRef.current;
        const w = wsRef.current;
        const t = terminalRef.current;
        if (!f || !t) return;
        f.fit();
        if (w?.readyState === WebSocket.OPEN) {
          w.send(JSON.stringify({ type: "resize", cols: t.cols, rows: t.rows }));
        }
      }, 100);
    });
    resizeObserver.observe(el);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
    };
  }, [taskId, worktreePath]);

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
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#fafafa] dark:bg-[#0a0a0a] text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("terminal.noWorktree")}</p>
        <p className="text-xs text-neutral-400 dark:text-neutral-600 mt-1">{t("terminal.noWorktreeDesc")}</p>
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
    <div className="relative h-full w-full bg-[#fafafa] dark:bg-[#0a0a0a]">
      <div
        className={[
          "absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-opacity duration-500",
          wsStatus === "connected" && !connectedVisible ? "opacity-0 pointer-events-none" : "opacity-100",
          "bg-white/60 dark:bg-black/40 backdrop-blur-sm",
        ].join(" ")}
        title={statusLabel}
      >
        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
        <span className="text-neutral-600 dark:text-neutral-300">{statusLabel}</span>
      </div>
      <div ref={containerRef} className="h-full w-full overflow-hidden" />
    </div>
  );
}
