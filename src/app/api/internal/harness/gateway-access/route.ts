import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { manageGatewayChannelAccess } from "@/lib/harness/gateway-channel-access";
import { requireSignedInternalRequest } from "@/lib/internal-api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["authorize", "bind_workspace", "bind_projects", "unbind", "revoke", "get"]),
  gatewayInboundId: z.string().trim().min(1).max(128),
  workspace: z.string().trim().min(1).max(512).optional(),
  projects: z.array(z.string().trim().min(1).max(512)).min(1).max(50).optional(),
  chatName: z.string().trim().min(1).max(160).optional(),
}).strict();

export async function POST(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid gateway channel access request" }, { status: 400 });
  }
  try {
    const result = await manageGatewayChannelAccess(parsed.data);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
