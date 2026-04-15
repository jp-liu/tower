import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { startPtyExecution } from "@/actions/agent-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  prompt: z.string().optional().default(""),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { taskId } = await params;
  const idError = validateTaskId(taskId);
  if (idError) return idError;

  try {
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const result = await startPtyExecution(taskId, parsed.data.prompt);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
