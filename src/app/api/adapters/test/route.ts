import { NextRequest, NextResponse } from "next/server";
import { getAdapter, listAdapters } from "@/lib/adapters/registry";

export async function POST(request: NextRequest) {
  try {
    const { adapterType, cwd } = await request.json();
    const adapter = getAdapter(adapterType);
    const result = await adapter.testEnvironment(cwd || process.cwd());
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ adapters: listAdapters() });
}
