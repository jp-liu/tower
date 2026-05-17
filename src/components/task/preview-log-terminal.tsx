"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTheme } from "next-themes";
import { getActualWsPort } from "@/actions/config-actions";
import { PREVIEW_TASK_ID } from "@/lib/preview/ws-constants";
import "@xterm/xterm/css/xterm.css";

export interface PreviewLogTerminalProps {
  previewKey: string;
  taskId: string;
}

/**
 * 内嵌的 xterm.js 视图，接收 PreviewSession 的 PTY 输出流。
 *
 * 通过 dynamic({ ssr: false }) 加载（见 preview-panel.tsx），不能在服务端渲染：
 * - @xterm/xterm 在模块加载期访问 window
 */
export function PreviewLogTerminal({
  previewKey,
  taskId,
}: PreviewLogTerminalProps) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const isDark = resolvedTheme !== "light";
    const terminal = new Terminal({
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: 12,
      scrollback: 5000,
      cursorBlink: false,
      disableStdin: true, // 只读 — 日志面板用户不输入
      allowTransparency: false,
      convertEol: true, // \n → \r\n（PTY 输出可能只有 \n）
      theme: isDark
        ? { background: "#0a0a0a", foreground: "#e5e5e5" }
        : { background: "#fafafa", foreground: "#171717" },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    // hide stdin helper textarea
    const helperTextarea =
      containerRef.current.querySelector<HTMLTextAreaElement>(
        ".xterm-helper-textarea",
      );
    if (helperTextarea) helperTextarea.style.opacity = "0";

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    try {
      fitAddon.fit();
    } catch {
      /* container size not ready */
    }

    let aborted = false;
    let ws: WebSocket | null = null;
    void (async () => {
      const wsPort = await getActualWsPort();
      if (aborted) return;
      const params = new URLSearchParams({
        taskId: PREVIEW_TASK_ID,
        role: "terminal",
        previewKey,
        connectionId: crypto.randomUUID(),
        clientTaskId: taskId,
      });
      ws = new WebSocket(`ws://localhost:${wsPort}/?${params.toString()}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onmessage = (e) => {
        const data =
          typeof e.data === "string"
            ? e.data
            : new TextDecoder().decode(e.data as ArrayBuffer);
        terminal.write(data);
      };
    })();

    // Window resize → re-fit
    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      aborted = true;
      window.removeEventListener("resize", handleResize);
      // Close in CONNECTING or OPEN; browser cancels handshake if still connecting.
      // Avoids a leak where user collapses the drawer before WS finishes opening.
      wsRef.current?.close();
      wsRef.current = null;
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      fitAddonRef.current = null;
    };
  }, [previewKey, taskId, resolvedTheme]);

  return <div ref={containerRef} className="size-full bg-black" />;
}
