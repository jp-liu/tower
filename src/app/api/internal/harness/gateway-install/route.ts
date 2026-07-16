import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { installTowerAgentExtension } from "@/lib/extensions/tower-agent-install";

const bodySchema = z.object({
  gateway: z.enum(["hermes", "openclaw"]),
  profile: z.string().min(1).max(80).optional(),
  displayName: z.string().min(1).max(80).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const report = await installTowerAgentExtension(parsed.data);
  return NextResponse.json({ ok: report.success, report });
}
