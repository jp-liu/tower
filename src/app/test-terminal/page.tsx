"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";

const TerminalView = dynamic(() => import("./terminal-view"), { ssr: false });

export default function TestTerminalPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/test-terminal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start session");
        return;
      }
      setSessionId(data.sessionId);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  }, []);

  const handleStop = useCallback(() => {
    setSessionId(null);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#111" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ color: "#fff", fontSize: 16, margin: 0 }}>Terminal Test Page</h1>
        {!sessionId ? (
          <button
            onClick={handleStart}
            disabled={starting}
            style={{
              padding: "6px 16px",
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: starting ? "wait" : "pointer",
              opacity: starting ? 0.5 : 1,
            }}
          >
            {starting ? "Starting..." : "Start bash session"}
          </button>
        ) : (
          <button
            onClick={handleStop}
            style={{
              padding: "6px 16px",
              background: "#ef4444",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Stop
          </button>
        )}
        {error && <span style={{ color: "#f87171", fontSize: 13 }}>{error}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {sessionId ? (
          <TerminalView
            sessionId={sessionId}
            onSessionEnd={(code) => {
              console.log("Session ended with code:", code);
              setSessionId(null);
            }}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#666" }}>
            Click &quot;Start bash session&quot; to launch a terminal
          </div>
        )}
      </div>
    </div>
  );
}
