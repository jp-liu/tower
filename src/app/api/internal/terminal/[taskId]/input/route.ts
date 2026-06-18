import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/pty/session-store";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { planTerminalWrite, hexTail } from "@/lib/pty/terminal-submit";

// Prevent response caching
export const dynamic = "force-dynamic";
// Require Node.js runtime — node-pty sessions only exist in Node.js process
export const runtime = "nodejs";

/**
 * Delay before the standalone submit CR. The message body and the Enter key MUST arrive
 * in separate PTY reads, otherwise the Claude TUI folds the trailing CR into the pasted
 * text as a newline instead of submitting. This mirrors the human/browser timing gap
 * between typing and pressing Enter.
 */
const DEFAULT_SUBMIT_DELAY_MS = 80;

const bodySchema = z.object({
  text: z.string().min(1).max(10000),
  // When true (default), the message is submitted: trailing newlines are trimmed and a
  // standalone CR is delivered separately. When false, text is forwarded verbatim.
  submit: z.boolean().optional(),
  submitDelayMs: z.number().int().min(0).max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { taskId } = await params;

  const invalid = validateTaskId(taskId);
  if (invalid) return invalid;

  // Parse and validate request body
  let parsed;
  try {
    const body = await request.json();
    parsed = bodySchema.safeParse(body);
  } catch {
    return NextResponse.json(
      { error: "Invalid body: text field required (string, 1-10000 chars)" },
      { status: 400 }
    );
  }

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body: text field required (string, 1-10000 chars)" },
      { status: 400 }
    );
  }

  const session = getSession(taskId);
  if (!session) {
    return NextResponse.json(
      { error: "No active session" },
      { status: 404 }
    );
  }

  if (session.killed) {
    return NextResponse.json(
      { error: "Session has exited" },
      { status: 410 }
    );
  }

  const submit = parsed.data.submit ?? true;
  const { body, submitKey } = planTerminalWrite(parsed.data.text, submit);

  // Instrumentation: shows exactly what bytes reached the PTY for this task. The tail
  // hex confirms whether a real CR (0d) is present and whether it was glued to the text.
  console.error(
    `[terminal-input] task=${taskId} recvBytes=${parsed.data.text.length} ` +
      `recvTailHex=[${hexTail(parsed.data.text)}] submit=${submit} ` +
      `bodyBytes=${body.length} submitKeyHex=[${submitKey ? hexTail(submitKey) : "none"}]`
  );

  // Write the message body first. The submit CR is delivered as a SEPARATE keystroke
  // after a short delay so the TUI registers it as Enter, not a pasted newline.
  if (body.length > 0) {
    session.write(body);
  }

  if (submitKey) {
    const delay = parsed.data.submitDelayMs ?? DEFAULT_SUBMIT_DELAY_MS;
    setTimeout(() => {
      const live = getSession(taskId);
      if (live && !live.killed) {
        live.write(submitKey);
      }
    }, delay);
  }

  return NextResponse.json({ ok: true, taskId, submitted: submit });
}
