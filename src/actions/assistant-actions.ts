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
import { providerRegistry } from "@/lib/ai/providers";
import { mergeProviderProcess, terminalBaseEnvironment } from "@/lib/ai/provider-host";

/**
 * Spawn a fresh Claude CLI PTY session for the global assistant (BE-01).
 * Destroys any existing assistant session first (UX-01).
 * Uses --allowedTools mcp__tower__* (BE-03) and --append-system-prompt (BE-02).
 * Does NOT inject TOWER_TASK_ID — assistant has no associated task.
 *
 * @param sessionId - When provided, resumes an existing Claude CLI session via --resume.
 *                    When omitted, starts a new session with a generated --session-id.
 */
export async function startAssistantSession(sessionId?: string): Promise<void> {
  // UX-01: Ensure a clean slate — destroy any existing assistant session
  destroySession(ASSISTANT_SESSION_KEY);

  // Resolve CLI adapter from AI abstraction layer
  const { provider } = await resolveCliAdapter("terminal");

  // BE-02: Read the configured system prompt (default defined in config-defaults.ts)
  const systemPrompt = await readConfigValue<string>(
    "assistant.systemPrompt",
    "You are Tower Assistant, an AI operator for the Tower task management platform."
  );

  // Tower project root is the cwd for the assistant session — `getPackageRoot()`
  // (not `process.cwd()`) because the standalone server runs from `.next/standalone/`.
  const { getPackageRoot } = await import("@/lib/tower-paths");
  const cwd = getPackageRoot();

  // Build extra args for assistant-specific behavior
  const extraArgs: string[] = provider.name === "claude"
    ? ["--allowedTools", "mcp__tower__*"]
    : [];

  // Session management: resume existing or start new with a generated ID
  if (!sessionId && provider.name === "claude") {
    extraArgs.push("--session-id", randomUUID());
  }

  const resolved = await providerRegistry.createResolvedCliAdapter(provider.name, cwd);
  if (!resolved) throw new Error(`Provider "${provider.name}" does not support CLI sessions`);
  const processSpec = mergeProviderProcess(resolved.adapter.buildSessionProcess({
    prompt: "",
    cwd,
    mode: sessionId ? { type: "resume", sessionId } : { type: "fresh" },
    systemPrompt,
    extraArgs,
  }), resolved.commandPath);

  // BE-01: Spawn the PTY session keyed by __assistant__
  createSession(
    ASSISTANT_SESSION_KEY,
    processSpec.command,
    processSpec.args,
    cwd,
    () => {},
    () => {},
    Object.fromEntries(
      Object.entries(processSpec.envPatch ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    undefined,
    undefined,
    processSpec.initialInput,
    terminalBaseEnvironment(),
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
