import { NextRequest, NextResponse } from "next/server";
import { existsSync, statSync, createReadStream } from "node:fs";
import path from "node:path";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { getExtensionsDir } from "@/lib/tower-dir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve `monaco-editor/min/vs/` files directly from the extensions workspace.
 *
 * Why not just put them in `public/vs/`? Next.js standalone builds a static
 * asset manifest at build time and only serves what was present then. Files
 * we copy into `<standaloneDir>/public/` at runtime are invisible to the
 * built-in static handler, which made the install-then-load-editor flow
 * silently fail with "Loading editor…" stuck forever.
 *
 * This route reads straight from `~/.tower/extensions/node_modules/
 * monaco-editor/min/vs/<path>` — no copy step, no manifest dependency.
 */

const MIME: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};

function contentTypeFor(filename: string): string {
  return MIME[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { path: segments } = await ctx.params;
  // Reject path traversal — only allow simple segments.
  for (const s of segments) {
    if (!s || s === "." || s === ".." || s.includes("/") || s.includes("\\")) {
      return new NextResponse("forbidden", { status: 403 });
    }
  }

  // Layout is the tarball-extracted form (see lib/extensions/definitions/monaco.ts):
  //   ~/.tower/extensions/monaco/min/vs/<path>
  const monacoRoot = path.join(getExtensionsDir(), "monaco", "min", "vs");
  const filePath = path.join(monacoRoot, ...segments);

  // Defence in depth — make sure the resolved path stays under monacoRoot.
  if (!path.resolve(filePath).startsWith(path.resolve(monacoRoot))) {
    return new NextResponse("forbidden", { status: 403 });
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return new NextResponse("monaco asset not found — install the editor extension in Settings", {
      status: 404,
    });
  }

  const stream = createReadStream(filePath) as unknown as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(filePath),
      "Content-Length": String(statSync(filePath).size),
      // Monaco assets are content-versioned by the package version, fine to
      // cache aggressively. The browser won't re-request unchanged files
      // across an extension reinstall.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
