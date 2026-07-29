import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSignedInternalRequest } from "@/lib/internal-api-auth";
import {
  getRemoteProjectProvisionStatus,
  provisionRemoteProject,
  setRemoteProjectAccessMode,
} from "@/lib/harness/remote-project-provisioner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("PROVISION"),
    gitUrl: z.string().trim().min(1).max(2_000).optional(),
    workspaceId: z.string().trim().min(1).max(128).optional(),
    localRoot: z.string().trim().min(1).max(2_000).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    directoryName: z.string().trim().min(1).max(200).optional(),
    accessMode: z.enum(["REVIEW_ONLY", "FULL_WORK"]).optional(),
  }).strict(),
  z.object({
    action: z.literal("SET_MODE"),
    projectId: z.string().trim().min(1).max(128),
    accessMode: z.enum(["REVIEW_ONLY", "FULL_WORK"]),
  }).strict(),
  z.object({
    action: z.literal("STATUS"),
    projectId: z.string().trim().min(1).max(128),
  }).strict(),
]);

export async function POST(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid remote project request" }, { status: 400 });
  try {
    switch (parsed.data.action) {
      case "PROVISION": {
        const { action: _, ...input } = parsed.data;
        void _;
        return NextResponse.json(await provisionRemoteProject(input));
      }
      case "SET_MODE":
        return NextResponse.json(await setRemoteProjectAccessMode(parsed.data.projectId, parsed.data.accessMode));
      case "STATUS":
        return NextResponse.json(await getRemoteProjectProvisionStatus(parsed.data.projectId));
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
