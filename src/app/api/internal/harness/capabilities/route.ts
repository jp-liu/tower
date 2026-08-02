import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSignedInternalRequest } from "@/lib/internal-api-auth";
import {
  discoverGatewayCapabilities,
  readCapabilityRequest,
  submitCapabilityRequest,
} from "@/lib/gateway/capability-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const taskIdSchema = z.string().trim().min(1).max(128);
const requestIdSchema = z.string().uuid();

export async function GET(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const url = new URL(request.url);
  const taskId = taskIdSchema.safeParse(url.searchParams.get("taskId"));
  if (!taskId.success) return NextResponse.json({ error: "Invalid taskId" }, { status: 400 });
  const rawRequestId = url.searchParams.get("requestId");
  try {
    if (rawRequestId) {
      const requestId = requestIdSchema.parse(rawRequestId);
      return NextResponse.json(await readCapabilityRequest(requestId, taskId.data));
    }
    return NextResponse.json(await discoverGatewayCapabilities(taskId.data));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  try {
    return NextResponse.json(await submitCapabilityRequest(await request.json()));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
