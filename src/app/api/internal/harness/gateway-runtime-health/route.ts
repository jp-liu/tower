import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSignedInternalRequest } from "@/lib/internal-api-auth";
import { getGatewayRuntimeHealth } from "@/lib/harness/gateway-runtime-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = z.object({
    gateway: z.enum(["openclaw", "hermes"]),
    trace: z.string().trim().min(1).max(512).optional(),
    includeLogs: z.boolean().optional(),
  }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid gateway runtime health request" }, { status: 400 });
  try {
    return NextResponse.json(await getGatewayRuntimeHealth(parsed.data));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
