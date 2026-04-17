"use server";

import {
  createSession,
  destroySession,
  getSession,
} from "@/lib/pty/session-store";
import { readConfigValue } from "@/lib/config-reader";
import { db } from "@/lib/db";
import { ASSISTANT_SESSION_KEY } from "@/lib/assistant-constants";

const DEFAULT_SYSTEM_PROMPT =
  "You are Tower Assistant, an AI operator for the Tower task management platform. You help users create, organize, query, and track tasks and projects using Tower MCP tools. You do NOT write or edit code — you are an operator, not a developer. Always respond in the same language the user uses.";

/**
 * Spawn a fresh Claude CLI PTY session for the global assistant (BE-01).
 * Destroys any existing assistant session first (UX-01).
 * Uses --allowedTools mcp__tower__* (BE-03) and --append-system-prompt (BE-02).
 * Does NOT inject AI_MANAGER_TASK_ID — assistant has no associated task.
 */
export async function startAssistantSession(): Promise<void> {
  // UX-01: Ensure a clean slate — destroy any existing assistant session
  destroySession(ASSISTANT_SESSION_KEY);

  // Fetch the default CLI profile
  const profile = await db.cliProfile.findFirst({ where: { isDefault: true } });
  if (!profile) {
    throw new Error(
      "No default CLI profile — configure one in Settings"
    );
  }

  // Parse profile JSON fields
  let profileBaseArgs: string[];
  try {
    profileBaseArgs = JSON.parse(profile.baseArgs) as string[];
  } catch {
    throw new Error("CLI Profile baseArgs 格式损坏，请在 Settings 中修复");
  }

  let profileEnvVars: Record<string, string>;
  try {
    profileEnvVars = JSON.parse(profile.envVars) as Record<string, string>;
  } catch {
    throw new Error("CLI Profile envVars 格式损坏，请在 Settings 中修复");
  }

  // BE-02: Read the configured system prompt
  const systemPrompt = await readConfigValue<string>(
    "assistant.systemPrompt",
    DEFAULT_SYSTEM_PROMPT
  );

  // Tower project root is the cwd for the assistant session
  const cwd = process.cwd();

  // Build CLI arguments
  const claudeArgs: string[] = [
    ...profileBaseArgs,
    // BE-03: Restrict to Tower MCP tools only
    "--allowedTools",
    "mcp__tower__*",
    // BE-02: Inject operator identity prompt
    "--append-system-prompt",
    systemPrompt,
  ];

  // Build env overrides — only profile vars, no AI_MANAGER_TASK_ID (assistant has no task)
  const envOverrides: Record<string, string> = { ...profileEnvVars };

  // BE-01: Spawn the PTY session keyed by __assistant__
  createSession(
    ASSISTANT_SESSION_KEY,
    profile.command,
    claudeArgs,
    cwd,
    () => {},
    () => {},
    envOverrides
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
