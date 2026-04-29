"use server";

import { randomUUID } from "crypto";
import {
  createSession,
  destroySession,
  getSession,
} from "@/lib/pty/session-store";
import { readConfigValue } from "@/lib/config-reader";
import { resolveCliAdapter } from "@/lib/ai/capability-resolver";
import { ASSISTANT_SESSION_KEY } from "@/lib/assistant-constants";

/**
 * Spawn a fresh Claude CLI PTY session for the global assistant (BE-01).
 * Destroys any existing assistant session first (UX-01).
 * Uses --allowedTools mcp__tower__* (BE-03) and --append-system-prompt (BE-02).
 * Does NOT inject AI_MANAGER_TASK_ID — assistant has no associated task.
 *
 * @param sessionId - When provided, resumes an existing Claude CLI session via --resume.
 *                    When omitted, starts a new session with a generated --session-id.
 */
export async function startAssistantSession(sessionId?: string): Promise<void> {
  // UX-01: Ensure a clean slate — destroy any existing assistant session
  destroySession(ASSISTANT_SESSION_KEY);

  // Resolve CLI adapter from AI abstraction layer
  const { adapter: cliAdapter } = await resolveCliAdapter("terminal");

  // BE-02: Read the configured system prompt (default defined in config-defaults.ts)
  const systemPrompt = await readConfigValue<string>(
    "assistant.systemPrompt",
    "You are Tower Assistant, an AI operator for the Tower task management platform."
  );

  // Tower project root is the cwd for the assistant session
  const cwd = process.cwd();

  // Build extra args for assistant-specific behavior
  const extraArgs: string[] = [
    // BE-03: Restrict to Tower MCP tools only
    "--allowedTools",
    "mcp__tower__*",
    // BE-02: Inject operator identity prompt
    "--append-system-prompt",
    systemPrompt,
  ];

  // Session management: resume existing or start new with a generated ID
  if (sessionId) {
    extraArgs.push("--resume", sessionId);
  } else {
    extraArgs.push("--session-id", randomUUID());
  }

  // Adapter builds the full spawn command (includes --dangerously-skip-permissions etc.)
  const spawnResult = cliAdapter.buildSpawnArgs({
    taskId: ASSISTANT_SESSION_KEY,
    prompt: "",
    cwd,
    extraArgs,
  });

  // BE-01: Spawn the PTY session keyed by __assistant__
  createSession(
    ASSISTANT_SESSION_KEY,
    spawnResult.command,
    spawnResult.args,
    cwd,
    () => {},
    () => {},
    spawnResult.env
  );
}

/**
 * Destroy the active assistant PTY session (BE-05).
 */
export async function stopAssistantSession(): Promise<void> {
  destroySession(ASSISTANT_SESSION_KEY);
}

/**
 * Returns "running" if an active assistant session exists, "idle" otherwise (BE-06).
 */
export async function getAssistantSessionStatus(): Promise<"running" | "idle"> {
  const session = getSession(ASSISTANT_SESSION_KEY);
  if (!session || session.killed) {
    return "idle";
  }
  return "running";
}
