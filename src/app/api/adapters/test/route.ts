import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { existsSync } from "fs";
import { getAdapter, listAdapters } from "@/lib/adapters/registry";
import { db } from "@/lib/db";

const bodySchema = z.object({
  adapterType: z.string(),
  cwd: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
    }

    const { adapterType, cwd } = parsed.data;

    // Validate cwd: must be an existing project localPath or use process.cwd()
    let resolvedCwd = process.cwd();
    if (cwd) {
      const project = await db.project.findFirst({ where: { localPath: cwd } });
      if (!project) {
        return NextResponse.json(
          { ok: false, error: "cwd must be a registered project local path" },
          { status: 400 }
        );
      }
      if (!existsSync(cwd)) {
        return NextResponse.json(
          { ok: false, error: "cwd directory does not exist" },
          { status: 400 }
        );
      }
      resolvedCwd = cwd;
    }

    const adapter = getAdapter(adapterType);
    const result = await adapter.testEnvironment(resolvedCwd);
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
