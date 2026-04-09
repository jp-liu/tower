import { NextResponse } from "next/server";
import { createSession } from "@/lib/pty/session-store";

/**
 * POST /api/test-terminal
 * Creates a simple bash PTY session for testing terminal connectivity.
 * No database, no task logic — just spawns bash and returns a sessionId.
 */
export async function POST() {
  const sessionId = `test-${Date.now()}`;

  try {
    // Use the user's default shell (e.g. zsh) so aliases and config are loaded
    const shell = process.env.SHELL ?? "/bin/zsh";

    createSession(
      sessionId,
      shell,
      ["--login"],
      process.env.HOME ?? "/tmp",
      () => {}, // onData — no-op, ws-server wires the real listener
      (exitCode) => {
        console.error(`[test-terminal] Session ${sessionId} exited with code ${exitCode}`);
      }
    );

    console.error(`[test-terminal] Created session: ${sessionId}`);
    return NextResponse.json({ sessionId });
  } catch (error: unknown) {
    console.error("[test-terminal] Failed to create session:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
