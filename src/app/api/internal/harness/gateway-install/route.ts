import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { installHermesGateway } from "@/lib/ai/install-orchestrator";

const bodySchema = z.object({
  gateway: z.enum(["hermes"]),
  profile: z.string().min(1).max(80).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const report = await installHermesGateway(parsed.data.profile);
  return NextResponse.json({ ok: report.ok, report });
}
