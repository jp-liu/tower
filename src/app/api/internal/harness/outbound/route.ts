import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enqueueHarnessOutbound } from "@/lib/harness/harness-outbound";
import { requireSignedInternalRequest } from "@/lib/internal-api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  taskId: z.string().trim().min(1).max(128),
  gateway: z.enum(["hermes", "openclaw"]),
  downstream: z.string().trim().max(128).nullish(),
  dest: z.string().trim().max(1024).nullish(),
  requestedTo: z.string().trim().max(1024).nullish(),
  profile: z.string().trim().max(256).nullish(),
  scope: z.enum(["work", "unattended"]),
  expectReply: z.boolean(),
  message: z.string().trim().min(1).max(16_000),
  presentation: z.unknown().optional(),
  dedupKey: z.string().trim().min(1).max(256).nullish(),
}).strict();

export async function POST(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid durable harness outbound request" }, { status: 400 });
  }
  try {
    return NextResponse.json(await enqueueHarnessOutbound(parsed.data));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
