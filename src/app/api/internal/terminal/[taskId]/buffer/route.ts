import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/pty/session-store";
import { requireLocalhost } from "@/lib/internal-api-guard";

// Prevent response caching — output changes on every call
export const dynamic = "force-dynamic";
// Require Node.js runtime — node-pty sessions only exist in Node.js process
export const runtime = "nodejs";

const linesSchema = z.coerce.number().int().min(1).max(500).default(100);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { taskId } = await params;

  const session = getSession(taskId);
  if (!session) {
    return NextResponse.json(
      { error: "No active session" },
      { status: 404 }
    );
  }

  // Parse optional ?lines= query param
  const linesParam = request.nextUrl.searchParams.get("lines");
  const parseResult = linesSchema.safeParse(linesParam ?? undefined);
  const lineCount = parseResult.success ? parseResult.data : 100;

  const buffer = session.getBuffer();
  const allLines = buffer.split("\n");
  const lines = allLines.slice(-lineCount);

  return NextResponse.json({
    taskId,
    lines,
    total: lines.length,
    killed: session.killed,
  });
}
