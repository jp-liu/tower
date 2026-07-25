import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function retired(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;
  return NextResponse.json({ error: "legacy_assistant_endpoint_removed" }, { status: 410 });
}

export const POST = retired;
export const DELETE = retired;
export const GET = retired;
