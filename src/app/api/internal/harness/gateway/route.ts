import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSignedInternalRequest } from "@/lib/internal-api-auth";
import {
  completeGatewayDiscussion,
  completeGatewayInbound,
  completeGatewayWork,
  confirmGatewayTaskCreated,
  retryGatewayDeliveries,
  routeGatewayInbound,
} from "@/lib/harness/gateway-router";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const inboundSchema = z.object({
  gateway: z.string().trim().min(1).max(64),
  platform: z.string().trim().min(1).max(64),
  chatId: z.string().trim().min(1).max(512),
  platformMessageId: z.string().trim().min(1).max(512),
  senderId: z.string().trim().min(1).max(512).optional(),
  chatName: z.string().trim().min(1).max(160).optional(),
  threadId: z.string().trim().min(1).max(512).optional(),
  rootMessageId: z.string().trim().min(1).max(512).optional(),
  replyToMessageId: z.string().trim().min(1).max(512).optional(),
  quotedText: z.string().max(16_000).optional(),
  taskId: z.string().trim().min(1).max(128).optional(),
  project: z.string().trim().min(1).max(512).optional(),
  intent: z.enum(["DIRECT", "TOWER", "PROJECT_DISCUSSION", "PROJECT_WORK"]),
  content: z.string().trim().min(1).max(16_000).refine(
    (value) => Buffer.byteLength(value, "utf8") <= 64_000,
    "Gateway payload exceeds the 64 KB storage budget",
  ),
  sessionAction: z.enum(["CONTINUE", "NEW", "CLOSE"]).optional(),
  startNewWork: z.boolean().optional(),
}).strict();

const completionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("discussion"),
    inboundId: z.string().min(1).max(128),
    response: z.string().trim().min(1).max(16_000),
    reviewerTaskId: z.string().min(1).max(128),
  }).strict(),
  z.object({
    action: z.literal("task_created"),
    inboundId: z.string().min(1).max(128),
    taskId: z.string().min(1).max(128),
    reviewerTaskId: z.string().min(1).max(128),
  }).strict(),
  z.object({
    action: z.literal("final"),
    inboundId: z.string().min(1).max(128),
    taskId: z.string().min(1).max(128),
    resultSummary: z.string().trim().min(1).max(8_000).optional(),
    reviewerTaskId: z.string().min(1).max(128),
  }).strict(),
  z.object({ action: z.literal("retry") }).strict(),
]);

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = inboundSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid gateway inbound message" }, { status: 400 });
  try {
    return NextResponse.json(await routeGatewayInbound(parsed.data));
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = z.object({ inboundId: z.string().min(1).max(128), response: z.unknown() })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid gateway completion" }, { status: 400 });
  try {
    await completeGatewayInbound(parsed.data.inboundId, parsed.data.response);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = completionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid gateway action" }, { status: 400 });
  try {
    switch (parsed.data.action) {
      case "discussion":
        return NextResponse.json(await completeGatewayDiscussion(
          parsed.data.inboundId,
          parsed.data.response,
          parsed.data.reviewerTaskId,
        ));
      case "task_created":
        return NextResponse.json(await confirmGatewayTaskCreated(
          parsed.data.inboundId,
          parsed.data.taskId,
          parsed.data.reviewerTaskId,
        ));
      case "final":
        return NextResponse.json(await completeGatewayWork(parsed.data));
      case "retry":
        return NextResponse.json(await retryGatewayDeliveries());
    }
  } catch (error) {
    return failure(error);
  }
}
