#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Codex turn-complete notifier fallback.
 *
 * Codex appends one JSON payload argument to the configured `notify` argv.
 * This adapter records the Codex thread ID and then forwards the event to
 * Tower's existing Stop endpoint. It is used only when managed-only policy
 * filters Tower's user hooks and no managed Tower hooks are installed.
 */

"use strict";

const { spawn } = require("child_process");
const http = require("http");
const https = require("https");

function getChain(args) {
  const index = args.indexOf("--chain-base64");
  if (index < 0 || !args[index + 1]) return [];
  try {
    const decoded = Buffer.from(args[index + 1], "base64").toString("utf8");
    const chain = JSON.parse(decoded);
    return Array.isArray(chain) && chain.every((part) => typeof part === "string") ? chain : [];
  } catch {
    return [];
  }
}

function runChain(chain, payload) {
  if (chain.length === 0) return;
  try {
    const child = spawn(chain[0], [...chain.slice(1), payload], {
      detached: true,
      env: process.env,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // A user's existing notifier must never block Tower notification delivery.
  }
}

function post(url, body, onDone) {
  const transport = url.protocol === "https:" ? https : http;
  const request = transport.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    timeout: 3000,
  });
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone();
  };
  request.on("response", (response) => {
    response.resume();
    response.on("end", finish);
  });
  request.on("error", finish);
  request.on("timeout", () => {
    request.destroy();
    finish();
  });
  request.write(body);
  request.end();
}

function main() {
  const args = process.argv.slice(2);
  const payload = args.at(-1) || "";
  runChain(getChain(args), payload);

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return;
  }
  if (event?.type !== "agent-turn-complete") return;

  const taskId = process.env.TOWER_TASK_ID;
  const apiBaseUrl = process.env.TOWER_API_URL;
  if (!taskId || !apiBaseUrl) return;

  let parsedApiUrl;
  try {
    parsedApiUrl = new URL(apiBaseUrl);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsedApiUrl.hostname)) return;
  } catch {
    return;
  }

  const sessionId = typeof event["thread-id"] === "string" ? event["thread-id"] : "";
  const stopBody = JSON.stringify({
    taskId,
    executionId: process.env.TOWER_EXECUTION_ID || "",
    sessionId,
    eventId: typeof event["turn-id"] === "string" ? event["turn-id"] : "",
    lastReply:
      typeof event["last-assistant-message"] === "string"
        ? event["last-assistant-message"].slice(0, 2000)
        : "",
  });
  const sendStop = () =>
    post(new URL("/api/internal/hooks/stop", parsedApiUrl), stopBody, () => {});
  if (!sessionId) {
    sendStop();
    return;
  }
  post(
    new URL("/api/internal/hooks/session", parsedApiUrl),
    JSON.stringify({ taskId, sessionId }),
    sendStop,
  );
}

main();
