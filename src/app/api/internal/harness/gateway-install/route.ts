import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { installTowerAgentExtension } from "@/lib/extensions/tower-agent-install";
import { requireLocalhost } from "@/lib/internal-api-guard";

const bodySchema = z.object({
  gateway: z.enum(["hermes", "openclaw"]),
  profile: z.string().min(1).max(80).optional(),
  displayName: z.string().min(1).max(80).optional(),
  env: z.record(z.string(), z.string()).optional(),
  accessPolicy: z.object({
    ownerIds: z.record(z.string(), z.array(z.string().trim().min(1).max(512))).optional(),
    trustedChannels: z.record(z.string(), z.array(z.string().trim().min(1).max(512))).optional(),
    channelScopes: z.record(z.string(), z.record(z.string(), z.string().trim().min(1).max(512))).optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const report = await installTowerAgentExtension(parsed.data);
  return NextResponse.json({ ok: report.success, report });
}
