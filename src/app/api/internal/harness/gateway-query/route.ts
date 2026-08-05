import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSignedInternalRequest } from "@/lib/internal-api-auth";
import {
  routeGatewayProjectQuery,
} from "@/lib/harness/gateway-router";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  gateway: z.string().trim().min(1).max(64),
  platform: z.string().trim().min(1).max(64),
  chatId: z.string().trim().min(1).max(512),
  senderId: z.string().trim().min(1).max(512).optional(),
  project: z.string().trim().min(1).max(512).optional(),
  question: z.string().trim().min(1).max(8_000),
}).strict();

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = querySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid gateway project query" }, { status: 400 });
  try {
    return NextResponse.json(await routeGatewayProjectQuery(parsed.data));
  } catch (error) {
    return failure(error);
  }
}
