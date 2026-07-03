"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { getActualWsPort, getConfigValues } from "@/actions/config-actions";
import { formatPathForInjection } from "@/lib/pty/paste-image";
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
 * Fit the terminal to its container and push the new size to the PTY — but ONLY
 * when the container is actually laid out (real, positive dimensions) and the
 * size actually changed.
 *
 * Why the guard matters (fixes intermittent "terminal went blank / only a few
 * lines left after switching pages"): this terminal lives inside a
 * react-reverse-portal node that gets **removed from the DOM** whenever its
 * OutPortal unmounts on navigation (`parent.replaceChild(placeholder, node)`).
 * A detached / zero-height container makes FitAddon.proposeDimensions() fall
 * back to its hard `2×1` minimum, so an unguarded `fit()` silently shrinks the
 * PTY to 2 cols × 1 row. The Claude CLI reacts to that SIGWINCH by clearing its
 * viewport and repainting only the current frame — wiping the visible
 * scrollback. On return the container regains its real size and everything
 * re-expands, but the history is already gone until a manual refresh replays it.
 *
 * Skipping fit while detached (offsetWidth/Height === 0) keeps the live
 * scrollback intact, and deduping the resize means returning to a same-sized
 * view never disturbs the running TUI at all.
 */
function fitTerminalToPty(
  container: HTMLElement | null,
  fitAddon: FitAddon | null,
  terminal: Terminal | null,
  ws: WebSocket | null,
  lastSent: { current: { cols: number; rows: number } | null }
): void {
  if (!container || !fitAddon || !terminal) return;
  // Container not laid out (detached portal node, display:none, mid-transition).
  // Fitting now would collapse the PTY to FitAddon's 2×1 minimum — bail.
  if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
  try {
    fitAddon.fit();
  } catch {
    return; // container detaching mid-call
  }
  if (ws?.readyState !== WebSocket.OPEN) return; // can't notify the PTY yet
  const { cols, rows } = terminal;
  if (lastSent.current?.cols === cols && lastSent.current?.rows === rows) return;
  lastSent.current = { cols, rows };
  ws.send(JSON.stringify({ type: "resize", cols, rows }));
}

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
  // Last cols/rows we told the PTY — dedup so a same-sized re-fit never disturbs the TUI.
  const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);

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

    // Image paste support. xterm only forwards clipboard *text*; an image blob is
    // dropped and the Ctrl+V keystroke never reaches the Claude CLI. We intercept
    // the paste in capture phase (before xterm's textarea handler), upload the
    // image to a host file, and inject its path as terminal input so the CLI can
    // read it. Non-image pastes fall through to xterm's normal text handling.
    const pasteHost = containerRef.current;
    const handleImagePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      let file: File | null = null;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          file = it.getAsFile();
          break;
        }
      }
      if (!file) return; // not an image — let xterm paste the text
      e.preventDefault();
      e.stopPropagation();
      void uploadAndInjectImage(file);
    };

    async function uploadAndInjectImage(file: File) {
      const toastId = toast.loading(t("terminal.pasteImageUploading"));
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl.split(",")[1] ?? "";
        const resp = await fetch(
          `/api/internal/terminal/${encodeURIComponent(taskId)}/paste-image`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mime: file.type, base64, name: file.name }),
          }
        );
        const result = (await resp.json().catch(() => null)) as { path?: string } | null;
        if (!resp.ok || !result?.path) {
          toast.error(t("terminal.pasteImageFailed"), { id: toastId });
          return;
        }
        const socket = wsRef.current;
        if (socket?.readyState !== WebSocket.OPEN) {
          toast.error(t("terminal.pasteImageFailed"), { id: toastId });
          return;
        }
        socket.send(formatPathForInjection(result.path));
        terminalRef.current?.focus();
        toast.success(t("terminal.pasteImageInserted"), { id: toastId });
      } catch {
        toast.error(t("terminal.pasteImageFailed"), { id: toastId });
      }
    }

    pasteHost.addEventListener("paste", handleImagePaste, true);

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

    fitTerminalToPty(containerRef.current, fitAddon, terminal, null, lastSentSizeRef);
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
        fitTerminalToPty(containerRef.current, fitAddon, terminal, wsRef.current, lastSentSizeRef);
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
        fitTerminalToPty(containerRef.current, fitAddon, terminal, socket, lastSentSizeRef);
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
      pasteHost.removeEventListener("paste", handleImagePaste, true);
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

    // Initial fit after portal re-mount (e.g. drawer → detail page).
    // Use rAF to ensure the container has its final layout dimensions.
    requestAnimationFrame(() => {
      fitTerminalToPty(containerRef.current, fitAddonRef.current, terminalRef.current, wsRef.current, lastSentSizeRef);
    });

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const el = containerRef.current;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fitTerminalToPty(containerRef.current, fitAddonRef.current, terminalRef.current, wsRef.current, lastSentSizeRef);
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
