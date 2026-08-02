import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { reconcileCapabilityCompletion } from "@/lib/gateway/capability-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  requestId: z.string().uuid(),
  runId: z.string().trim().min(1).max(256),
}).strict();

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(authorization);
  if (!match) return NextResponse.json({ error: "Unauthorized callback" }, { status: 401 });
  try {
    const body = bodySchema.parse(await request.json());
    const result = await reconcileCapabilityCompletion({
      ...body,
      callbackToken: match[1],
    });
    return NextResponse.json({ ok: true, requestId: body.requestId, status: result.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
