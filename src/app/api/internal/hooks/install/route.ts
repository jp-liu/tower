import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import * as path from "node:path";
import { getPackageRoot } from "@/lib/tower-paths";
import { providerRegistry } from "@/lib/ai/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function claudeHooks() {
  const hooks = providerRegistry.get("claude")?.cli?.adapter.hooks;
  if (!hooks) throw new Error("Claude hooks integration is unavailable");
  return hooks;
}

export async function GET(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const installed = (await claudeHooks().inspect({})).installed;
  const hookPath = path.join(getPackageRoot(), "scripts", "tower-post-tool-hook.js");

  return NextResponse.json({
    installed,
    hookPath,
  });
}

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const apiUrl = process.env.NEXTAUTH_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  await claudeHooks().install({ apiUrl });

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  await claudeHooks().uninstall({});

  return NextResponse.json({ success: true });
}
