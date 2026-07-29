import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSignedInternalRequest } from "@/lib/internal-api-auth";
import {
  diagnoseGatewayRequest,
  recoverGatewayRequest,
} from "@/lib/harness/gateway-diagnostics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = z.object({
    inboundId: z.string().trim().min(1).max(128).optional(),
    platformMessageId: z.string().trim().min(1).max(512).optional(),
  }).refine((value) => value.inboundId || value.platformMessageId, {
    message: "inboundId or platformMessageId is required",
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid gateway diagnostic request" }, { status: 400 });
  try {
    return NextResponse.json(await diagnoseGatewayRequest(parsed.data));
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = z.object({
    inboundId: z.string().trim().min(1).max(128),
  }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid gateway recovery request" }, { status: 400 });
  try {
    return NextResponse.json(await recoverGatewayRequest(parsed.data.inboundId));
  } catch (error) {
    return failure(error);
  }
}
