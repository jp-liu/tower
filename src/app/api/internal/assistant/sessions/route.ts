import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { ensureTowerDir } from "@/lib/init-tower";
import {
  convertSessionMessages,
  type SDKSessionMessage,
} from "@/lib/assistant-message-converter";
import {
  deriveSessionTitle,
  type DiskSessionInfo,
} from "@/lib/assistant-session-title";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Cap the listed sessions so an account with a long history still renders a
// sane dropdown. The on-disk store keeps everything; this only bounds the list.
const MAX_LISTED = 30;

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/internal/assistant/sessions
 *   - with ?sessionId=xxx → messages for that session
 *   - without sessionId   → the session list, enumerated from the durable
 *     on-disk SDK store (source of truth). The client localStorage registry is
 *     only an overlay (custom titles); it is NOT authoritative, so listing from
 *     disk recovers conversations whose localStorage pointer was lost
 *     (interrupted first turn, cleared storage, different origin, >cap, etc).
 *
 * Each Tower environment writes to its own assistant projectKey dir
 * (`~/.tower/assistant` → `-...-tower-assistant`), so scoping listSessions to
 * `towerDir` inherently avoids cross-project leakage.
 */
export async function GET(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const towerDir = ensureTowerDir();

  // Collection request → return the list.
  if (!sessionId) {
    try {
      const { listSessions } = await import("@anthropic-ai/claude-agent-sdk");
      const raw = (await listSessions({ dir: towerDir })) as DiskSessionInfo[];
      const sessions = [...raw]
        .sort((a, b) => b.lastModified - a.lastModified)
        .slice(0, MAX_LISTED)
        .map((s) => ({
          id: s.sessionId,
          title: deriveSessionTitle(s),
          createdAt: new Date(s.createdAt ?? s.lastModified).toISOString(),
          updatedAt: new Date(s.lastModified).toISOString(),
        }));
      return NextResponse.json({ sessions });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[assistant-sessions] list error:", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Item request → return messages for the session.
  try {
    const { getSessionMessages } = await import(
      "@anthropic-ai/claude-agent-sdk"
    );
    const sdkMessages = (await getSessionMessages(sessionId, {
      dir: towerDir,
    })) as SDKSessionMessage[];
    const chatMessages = convertSessionMessages(sdkMessages);
    return NextResponse.json({ messages: chatMessages });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[assistant-sessions] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/internal/assistant/sessions?sessionId=xxx
 *
 * Remove the session from the durable on-disk store. Required now that the disk
 * is the source of truth — a localStorage-only delete would let the session
 * reappear on the next list/hydrate.
 */
export async function DELETE(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json({ error: "valid sessionId required" }, { status: 400 });
  }

  const towerDir = ensureTowerDir();
  try {
    const { deleteSession } = await import("@anthropic-ai/claude-agent-sdk");
    await deleteSession(sessionId, { dir: towerDir });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[assistant-sessions] delete error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/internal/assistant/sessions?sessionId=xxx  body: { title }
 *
 * Persist a renamed title to the on-disk store (customTitle) so it survives
 * localStorage loss / a different origin.
 */
export async function PATCH(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json({ error: "valid sessionId required" }, { status: 400 });
  }

  let title = "";
  try {
    const body = (await request.json()) as { title?: unknown };
    title = typeof body.title === "string" ? body.title.trim() : "";
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const towerDir = ensureTowerDir();
  try {
    const { renameSession } = await import("@anthropic-ai/claude-agent-sdk");
    await renameSession(sessionId, title, { dir: towerDir });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[assistant-sessions] rename error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
