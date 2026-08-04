import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { readConfigValue } from "@/lib/config-reader";
import { normalizeAssistantHistoryTurns } from "@/lib/ai/assistant-history";
import {
  AssistantSessionError,
  assistantMessagesToClient,
  assistantSessionIdSchema,
  assistantSessionService,
  legacySessionIdSchema,
  towerSessionIdSchema,
  type AssistantBinding,
} from "@/lib/ai/assistant-session-service";
import { assistantLegacyAdapter } from "@/lib/ai/assistant-legacy-adapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  workspaceId: z.string().min(1).max(128).nullable().optional(),
  workspaceName: z.string().max(256).nullable().optional(),
  projectId: z.string().min(1).max(128).nullable().optional(),
  projectName: z.string().max(256).nullable().optional(),
  versionId: z.string().min(1).max(128).nullable().optional(),
  versionName: z.string().max(256).nullable().optional(),
}).strict();

function safeError(code: string, status = 500) {
  return NextResponse.json({ error: code }, { status });
}

function hasBindingUpdate(body: z.infer<typeof patchSchema>): boolean {
  return ["workspaceId", "projectId", "versionId"].some((key) => Object.hasOwn(body, key));
}

async function resolveTowerSessionId(sessionId: string): Promise<string> {
  if (towerSessionIdSchema.safeParse(sessionId).success) return sessionId;
  const imported = await assistantLegacyAdapter.import(sessionId, assistantSessionService);
  return imported.id;
}

export async function GET(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const requestedId = request.nextUrl.searchParams.get("sessionId");
  if (!requestedId) {
    const originParam = request.nextUrl.searchParams.get("origin")?.toLowerCase();
    const origin = originParam === "gateway" ? "GATEWAY" : originParam === "all" ? "ALL" : "UI";
    try {
      const databaseSessions = await assistantSessionService.listSessions({ origin });
      // Legacy disk sessions are always UI-origin — skip them when explicitly asking for gateway.
      if (origin === "GATEWAY") {
        return NextResponse.json({ sessions: databaseSessions.slice(0, 50) });
      }
      const imported = await assistantSessionService.listImportedLegacyIds();
      let legacySessions: Array<Record<string, unknown>> = [];
      let legacyError: string | undefined;
      try {
        legacySessions = (await assistantLegacyAdapter.list())
          .filter((session) => !imported.has(session.sessionId))
          .map((session) => ({
            id: session.sessionId,
            title: session.title,
            createdAt: new Date(session.createdAt ?? session.lastModified).toISOString(),
            updatedAt: new Date(session.lastModified).toISOString(),
            lastMessageAt: new Date(session.lastModified).toISOString(),
            legacy: true,
          }));
      } catch {
        legacyError = "legacy_sessions_unavailable";
      }
      const sessions = [...databaseSessions, ...legacySessions]
        .sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)))
        .slice(0, 50);
      return NextResponse.json({ sessions, ...(legacyError ? { legacyError } : {}) });
    } catch {
      return safeError("sessions_unavailable");
    }
  }

  if (!assistantSessionIdSchema.safeParse(requestedId).success) return safeError("invalid_session_id", 400);
  try {
    const sessionId = await resolveTowerSessionId(requestedId);
    const historyTurns = normalizeAssistantHistoryTurns(
      await readConfigValue<number>("assistant.historyTurns", 20),
    );
    await assistantSessionService.prepareHistory({ sessionId, historyTurns });
    const [session, messages] = await Promise.all([
      assistantSessionService.getSessionView(sessionId),
      assistantSessionService.getMessages(sessionId),
    ]);
    return NextResponse.json({ sessionId, session, messages: assistantMessagesToClient(messages) });
  } catch {
    return safeError(legacySessionIdSchema.safeParse(requestedId).success ? "legacy_import_failed" : "session_unavailable");
  }
}

export async function DELETE(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;
  const requestedId = request.nextUrl.searchParams.get("sessionId");
  if (!requestedId || !assistantSessionIdSchema.safeParse(requestedId).success) return safeError("invalid_session_id", 400);

  try {
    if (legacySessionIdSchema.safeParse(requestedId).success) {
      const imported = await assistantSessionService.findImportedLegacy(requestedId);
      // Delete the legacy source first. If this fails the DB row stays in place,
      // preventing the source from reappearing as a seemingly new conversation.
      await assistantLegacyAdapter.delete(requestedId);
      if (imported) await assistantSessionService.deleteSession(imported.id);
      return NextResponse.json({ ok: true });
    }
    const session = await assistantSessionService.getSession(requestedId);
    if (session.legacySource === "claude-agent-sdk" && session.legacyId) {
      await assistantLegacyAdapter.delete(session.legacyId);
    }
    await assistantSessionService.deleteSession(requestedId);
    return NextResponse.json({ ok: true });
  } catch {
    return safeError("session_delete_failed");
  }
}

export async function PATCH(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;
  const requestedId = request.nextUrl.searchParams.get("sessionId");
  if (!requestedId || !assistantSessionIdSchema.safeParse(requestedId).success) return safeError("invalid_session_id", 400);
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch {
    return safeError("invalid_request", 400);
  }
  if (!body.title && !hasBindingUpdate(body)) return safeError("empty_update", 400);

  try {
    if (legacySessionIdSchema.safeParse(requestedId).success) {
      const imported = await assistantSessionService.findImportedLegacy(requestedId);
      const hasBinding = hasBindingUpdate(body);
      if (!imported && !hasBinding) {
        await assistantLegacyAdapter.rename(requestedId, body.title!);
        return NextResponse.json({ ok: true, sessionId: requestedId });
      }
    }

    const sessionId = await resolveTowerSessionId(requestedId);
    const raw = await assistantSessionService.getSession(sessionId);
    const binding: AssistantBinding | undefined = hasBindingUpdate(body) ? {
      ...(body.workspaceId ? { workspaceId: body.workspaceId } : {}),
      ...(body.projectId ? { projectId: body.projectId } : {}),
      ...(body.versionId ? { versionId: body.versionId } : {}),
    } : undefined;
    const session = await assistantSessionService.updateSession(sessionId, { title: body.title, binding });
    let legacySyncWarning: string | undefined;
    if (body.title && raw.legacySource === "claude-agent-sdk" && raw.legacyId) {
      try { await assistantLegacyAdapter.rename(raw.legacyId, body.title); }
      catch { legacySyncWarning = "legacy_rename_failed"; }
    }
    return NextResponse.json({ ok: true, sessionId, session, ...(legacySyncWarning ? { legacySyncWarning } : {}) });
  } catch (error) {
    if (error instanceof AssistantSessionError) return safeError(error.code, 400);
    return safeError("session_update_failed");
  }
}
