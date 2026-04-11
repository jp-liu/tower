import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/pty/session-store";
import { requireLocalhost } from "@/lib/internal-api-guard";

// Prevent response caching
export const dynamic = "force-dynamic";
// Require Node.js runtime — node-pty sessions only exist in Node.js process
export const runtime = "nodejs";

const bodySchema = z.object({
  text: z.string().min(1).max(10000),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { taskId } = await params;

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

  session.write(parsed.data.text);

  return NextResponse.json({ ok: true, taskId });
}
