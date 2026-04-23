#!/usr/bin/env node
/**
 * Tower Stop Hook
 *
 * Claude Code Stop hook that fires when Claude finishes responding.
 * Notifies Tower so the UI can show a "response complete" indicator.
 *
 * Environment:
 *   TOWER_TASK_ID  - Required. Skip if absent (not a Tower session).
 *   TOWER_API_URL  - Required. Base URL of the Tower server.
 *
 * Stdin: JSON object from Claude Code with { session_id, cwd, ... }
 */

"use strict";

const http = require("http");
const https = require("https");

function main() {
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

  let input = "";
  const timeout = setTimeout(() => process.exit(0), 5000);

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });

  process.stdin.on("end", () => {
    clearTimeout(timeout);

    let data;
    try { data = JSON.parse(input); } catch { process.exit(0); }

    const sessionId = data.session_id || "";

    // POST to Tower
    const url = new URL("/api/internal/hooks/stop", apiUrl);
    const payload = JSON.stringify({ taskId, sessionId });
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

  process.stdin.on("error", () => { clearTimeout(timeout); process.exit(0); });
  if (process.stdin.isTTY) { clearTimeout(timeout); process.exit(0); }
}

main();
