#!/usr/bin/env node
/**
 * Tower Stop Hook
 *
 * Claude Code Stop hook that fires when Claude finishes responding.
 * Notifies Tower so the UI can show a "response complete" indicator, and so a
 * derived child task can hand its turn back to the parent task for review.
 *
 * Environment:
 *   TOWER_TASK_ID  - Required. Skip if absent (not a Tower session).
 *   TOWER_API_URL  - Required. Base URL of the Tower server.
 *
 * Stdin: JSON object from Claude Code with { session_id, transcript_path, cwd, ... }
 */

"use strict";

const http = require("http");
const https = require("https");

/**
 * 从 Claude Code 的 transcript 提取最后一条 assistant 回复（截断 2000 字）。
 * 用于完成回推：父任务据此 review，不必读整个终端缓冲。best-effort，失败返回空串。
 * transcript 是 jsonl，行格式随 CC 版本略有差异，这里兼容 obj.message.content / obj.content。
 */
function extractLastAssistantText(transcriptPath) {
  if (!transcriptPath) return "";
  try {
    const fs = require("fs");
    const raw = fs.readFileSync(transcriptPath, "utf8");
    const lines = raw.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const msg = obj.message || obj;
      const role = msg.role || obj.type;
      if (role !== "assistant" || !msg.content) continue;
      let text = "";
      if (Array.isArray(msg.content)) {
        text = msg.content
          .filter((c) => c && c.type === "text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("\n")
          .trim();
      } else if (typeof msg.content === "string") {
        text = msg.content.trim();
      }
      if (text) return text.slice(0, 2000);
    }
  } catch {
    /* best effort — transcript unreadable */
  }
  return "";
}

function main() {
  // Always drain stdin first — Claude Code writes the hook payload there
  // and if we exit before reading it, Windows libuv can crash the parent
  // process on the now-orphaned write side of the pipe.
  let input = "";
  const timeout = setTimeout(() => process.exit(0), 5000);

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("error", () => { clearTimeout(timeout); process.exit(0); });
  if (process.stdin.isTTY) { clearTimeout(timeout); process.exit(0); }

  process.stdin.on("end", () => {
    clearTimeout(timeout);

    const taskId = process.env.TOWER_TASK_ID;
    if (!taskId) process.exit(0);

    const apiUrl = process.env.TOWER_API_URL;
    if (!apiUrl) process.exit(0);

    // SECURITY: Only talk to localhost
    try {
      const parsed = new URL(apiUrl);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
        process.exit(0);
      }
    } catch {
      process.exit(0);
    }

    let data;
    try { data = JSON.parse(input); } catch { process.exit(0); }

    const sessionId = data.session_id || "";
    const lastReply = extractLastAssistantText(data.transcript_path);

    // POST to Tower
    const url = new URL("/api/internal/hooks/stop", apiUrl);
    const payload = JSON.stringify({ taskId, sessionId, lastReply });
    const mod = url.protocol === "https:" ? https : http;

    const req = mod.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      timeout: 3000,
    }, () => process.exit(0));

    req.on("error", () => process.exit(0));
    req.on("timeout", () => { req.destroy(); process.exit(0); });
    req.write(payload);
    req.end();
  });
}

main();
