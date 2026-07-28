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
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

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

function post(url, body) {
  return new Promise((resolve) => {
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
      timeout: 1500,
    });
    request.on("response", (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode >= 200 && response.statusCode < 300));
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.write(body);
    request.end();
  });
}

function persistCompletion(signalDir, record) {
  if (!signalDir) return null;
  try {
    fs.mkdirSync(signalDir, { recursive: true, mode: 0o700 });
    const identity = `${record.body.executionId}:${record.body.eventId}`;
    const digest = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 32);
    const destination = path.join(signalDir, `provider-completion-${digest}.json`);
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, destination);
    return destination;
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWithRetry(url, body) {
  for (const waitMs of [0, 250, 750]) {
    if (waitMs) await delay(waitMs);
    if (await post(url, body)) return true;
  }
  return false;
}

async function main() {
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
  const eventId = typeof event["turn-id"] === "string" && event["turn-id"].trim()
    ? event["turn-id"].trim()
    : crypto.createHash("sha256").update(payload).digest("hex");
  const body = {
    taskId,
    executionId: process.env.TOWER_EXECUTION_ID || "",
    sessionId,
    eventId,
    lastReply:
      typeof event["last-assistant-message"] === "string"
        ? event["last-assistant-message"].slice(0, 2000)
        : "",
  };
  const pendingPath = persistCompletion(process.env.TOWER_SIGNAL_DIR, {
    version: 1,
    provider: "codex",
    createdAt: new Date().toISOString(),
    body,
  });
  if (sessionId) {
    await postWithRetry(
      new URL("/api/internal/hooks/session", parsedApiUrl),
      JSON.stringify({ taskId, sessionId }),
    );
  }
  const delivered = await postWithRetry(
    new URL("/api/internal/hooks/stop", parsedApiUrl),
    JSON.stringify(body),
  );
  if (delivered && pendingPath) {
    try { fs.unlinkSync(pendingPath); } catch { /* startup recovery is idempotent */ }
  }
}

void main();
