#!/usr/bin/env node
/**
 * Tower PreToolUse Hook (shared by Claude Code + Codex CLI)
 *
 * Hard-blocks the CLI's native interactive-question tool (AskUserQuestion) on
 * terminals where no human is watching — those would deadlock forever since
 * Tower cannot see or click a native menu. This is the enforcement layer under
 * the guidance in task.systemDirective (see src/lib/config-defaults.ts).
 *
 * Decision (mirrors the escalation ladder):
 *   allow  ⇔  no parent task  AND  attended (case ①: a human is at THIS terminal)
 *   deny   ⇔  has parent (any) OR unattended  → route the question up the ladder
 *             (child → parent via stop hook, or ask_human / push_to_human)
 *
 * State sources (spawn-time env; TOWER_DATA_DIR is stripped from the PTY env, so
 * the resolved signal dir is injected directly — see buildEnvOverrides):
 *   TOWER_TASK_ID    - claims this terminal for a Tower task (skip if absent).
 *   TOWER_HAS_PARENT - "1" when the task was derived by a parent (static).
 *   TOWER_SIGNAL_DIR - Tower's signal dir; unattended ⇔ file `unattended-<taskId>`.
 *
 * Stdin: JSON from the CLI with { tool_name, tool_input, session_id, cwd, ... }.
 * Stdout (deny only): { hookSpecificOutput: { hookEventName, permissionDecision,
 *   permissionDecisionReason } }. Both providers honor this shape under their
 * bypass flags. Allow = exit 0 with no output. Exit is always 0.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// The native interactive-question tools we hard-block, per provider (verified
// live): Claude Code = `AskUserQuestion`, Codex CLI = `request_user_input`.
// Both are listed in this shared script — a session only ever exposes its own
// provider's name, so listing both is harmless. Keep this tight: every other
// tool passes through untouched (the matcher already scopes us; this is defense).
const BLOCKED_TOOLS = new Set(["AskUserQuestion", "request_user_input"]);

const DENY_REASON =
  "Blocked by Tower: this terminal has no human watching it (a derived child task, " +
  "or unattended goal mode), so a native interactive question would deadlock forever — " +
  "Tower cannot see or click the menu. Do NOT ask interactively here. Route the question " +
  "PLUS its concrete options up the escalation ladder instead: a derived child ends its " +
  "turn with the blocker as a plain-text final message (Tower wakes the parent to decide); " +
  "a parentless unattended task uses ask_human / push_to_human. See the escalation-ladder " +
  "section of your system directive.";

function allow() {
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

function main() {
  // Always drain stdin first — the CLI writes the hook payload there and if we
  // exit before reading it, Windows libuv can crash the parent on the orphaned
  // write side of the pipe.
  let input = "";
  const timeout = setTimeout(allow, 5000);

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("error", () => { clearTimeout(timeout); allow(); });
  if (process.stdin.isTTY) { clearTimeout(timeout); allow(); }

  process.stdin.on("end", () => {
    clearTimeout(timeout);

    const taskId = process.env.TOWER_TASK_ID;
    if (!taskId) allow(); // not a Tower-managed terminal → never interfere

    let data;
    try { data = JSON.parse(input); } catch { allow(); }

    const toolName = data && data.tool_name;
    if (!toolName || !BLOCKED_TOOLS.has(toolName)) allow(); // only ever touch the blocked tool

    const hasParent = !!process.env.TOWER_HAS_PARENT;
    const signalDir = process.env.TOWER_SIGNAL_DIR;
    const unattended = !!signalDir && fs.existsSync(path.join(signalDir, `unattended-${taskId}`));

    // Case ① only: no parent AND attended → a human is here to pick, allow.
    if (!hasParent && !unattended) allow();

    deny(DENY_REASON);
  });
}

main();
