#!/usr/bin/env node
/**
 * Tower PostToolUse Hook
 *
 * Claude Code PostToolUse hook that auto-captures file outputs as task assets.
 * When Claude writes/edits a file matching the configured extension whitelist,
 * this hook uploads it to Tower's internal API for asset tracking.
 *
 * Environment:
 *   TOWER_TASK_ID  - Required. The task ID to associate the asset with.
 *   TOWER_API_URL  - Required. Base URL of the Tower server (e.g. http://localhost:3000).
 *
 * Stdin: JSON object from Claude Code with { tool_name, tool_input, session_id, cwd, ... }
 * Exit: Always 0 (hook must never block Claude Code).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const DEFAULT_TYPES = ["png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "md", "txt", "json"];
const FILE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

function main() {
  const taskId = process.env.TOWER_TASK_ID;
  if (!taskId) {
    process.exit(0);
  }

  const apiUrl = process.env.TOWER_API_URL;
  if (!apiUrl) {
    process.exit(0);
  }

  // SECURITY: Only talk to localhost — refuse remote servers
  try {
    const parsed = new URL(apiUrl);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
      process.exit(0);
    }
  } catch {
    process.exit(0);
  }

  // Read stdin with timeout
  let input = "";
  const timeout = setTimeout(() => {
    // Stdin timeout — exit silently
    process.exit(0);
  }, 10000);

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });

  process.stdin.on("end", () => {
    clearTimeout(timeout);
    processInput(input, taskId, apiUrl);
  });

  process.stdin.on("error", () => {
    clearTimeout(timeout);
    process.exit(0);
  });

  // If stdin is not a pipe (e.g., running interactively), exit
  if (process.stdin.isTTY) {
    clearTimeout(timeout);
    process.exit(0);
  }
}

function processInput(input, taskId, apiUrl) {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const toolName = data.tool_name;
  if (!toolName || !FILE_WRITE_TOOLS.has(toolName)) {
    process.exit(0);
  }

  const filePath = data.tool_input && data.tool_input.file_path;
  if (!filePath) {
    process.exit(0);
  }

  // Resolve to absolute path
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(data.cwd || process.cwd(), filePath);

  // Check extension against whitelist
  const ext = path.extname(absolutePath).slice(1).toLowerCase();
  if (!ext) {
    process.exit(0);
  }

  // Try to fetch config from Tower, fall back to defaults
  fetchAllowedTypes(apiUrl, (types) => {
    if (!types.includes(ext)) {
      process.exit(0);
    }

    // Check file exists
    try {
      fs.statSync(absolutePath);
    } catch {
      process.exit(0);
    }

    // Upload to Tower
    uploadFile(apiUrl, taskId, absolutePath);
  });
}

function fetchAllowedTypes(apiUrl, callback) {
  const url = apiUrl + "/api/internal/hooks/upload";
  const mod = url.startsWith("https") ? https : http;

  const req = mod.get(url, (res) => {
    let body = "";
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => {
      try {
        const json = JSON.parse(body);
        if (Array.isArray(json.types)) {
          callback(json.types);
          return;
        }
      } catch {
        // Fall through to defaults
      }
      callback(DEFAULT_TYPES);
    });
  });

  req.on("error", () => {
    callback(DEFAULT_TYPES);
  });

  req.setTimeout(3000, () => {
    req.destroy();
    callback(DEFAULT_TYPES);
  });
}

function uploadFile(apiUrl, taskId, filePath) {
  const url = new URL("/api/internal/hooks/upload", apiUrl);
  const payload = JSON.stringify({ taskId, filePath });
  const mod = url.protocol === "https:" ? https : http;

  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
    timeout: 5000,
  };

  const req = mod.request(options, () => {
    // Response doesn't matter — fire and forget
    process.exit(0);
  });

  req.on("error", () => {
    process.exit(0);
  });

  req.on("timeout", () => {
    req.destroy();
    process.exit(0);
  });

  req.write(payload);
  req.end();
}

main();
