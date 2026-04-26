import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import * as path from "node:path";
import { ClaudeCliAdapter } from "@/lib/ai/adapters/cli/claude-cli-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const claudeAdapter = new ClaudeCliAdapter();

export async function GET(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const installed = await claudeAdapter.isHooksInstalled();
  const hookPath = path.join(process.cwd(), "scripts", "post-tool-hook.js");

  return NextResponse.json({
    installed,
    hookPath,
  });
}

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const apiUrl = process.env.NEXTAUTH_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  await claudeAdapter.installHooks(apiUrl);

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  await claudeAdapter.uninstallHooks();

  return NextResponse.json({ success: true });
}
