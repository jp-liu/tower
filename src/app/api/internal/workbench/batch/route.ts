import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSignedInternalRequest } from "@/lib/internal-api-auth";
import {
  acknowledgeWorkbenchBatch,
  heartbeatWorkbenchBatch,
  resolveWorkbenchBatch,
} from "@/lib/workbench/coordinator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ack"),
    batchId: z.string().trim().min(1).max(128),
    parentTaskId: z.string().trim().min(1).max(128),
    leaseToken: z.string().trim().min(1).max(128),
  }).strict(),
  z.object({
    action: z.literal("heartbeat"),
    batchId: z.string().trim().min(1).max(128),
    parentTaskId: z.string().trim().min(1).max(128),
    leaseToken: z.string().trim().min(1).max(128),
  }).strict(),
  z.object({
    action: z.literal("resolve"),
    batchId: z.string().trim().min(1).max(128),
    parentTaskId: z.string().trim().min(1).max(128),
    leaseToken: z.string().trim().min(1).max(128),
  }).strict(),
]);

export async function PUT(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Workbench batch transition" }, { status: 400 });
  }
  try {
    const result = parsed.data.action === "ack"
      ? await acknowledgeWorkbenchBatch(
          parsed.data.batchId,
          parsed.data.parentTaskId,
          parsed.data.leaseToken,
        )
      : parsed.data.action === "heartbeat"
        ? await heartbeatWorkbenchBatch(
            parsed.data.batchId,
            parsed.data.parentTaskId,
            parsed.data.leaseToken,
          )
        : await resolveWorkbenchBatch(
            parsed.data.batchId,
            parsed.data.parentTaskId,
            parsed.data.leaseToken,
          );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
