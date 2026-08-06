import "server-only";

import { convertSessionMessages, type SDKSessionMessage } from "@/lib/assistant-message-converter";
import { deriveSessionTitle, type DiskSessionInfo } from "@/lib/assistant-session-title";
import { ensureTowerDir } from "@/lib/init-tower";
import { isAssistantCarrierPrompt } from "./assistant-carrier-session";
import type { AssistantPart, AssistantSessionService } from "./assistant-session-service";
import { legacySessionIdSchema } from "./assistant-session-service";

export const MAX_LEGACY_SESSIONS = 50;

export interface LegacyAssistantStore {
  listSessions(options: { dir: string }): Promise<DiskSessionInfo[]>;
  getSessionMessages(sessionId: string, options: { dir: string }): Promise<SDKSessionMessage[]>;
  renameSession(sessionId: string, title: string, options: { dir: string }): Promise<void>;
  deleteSession(sessionId: string, options: { dir: string }): Promise<void>;
}

async function sdkStore(): Promise<LegacyAssistantStore> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  return {
    listSessions: (options) => sdk.listSessions(options) as Promise<DiskSessionInfo[]>,
    getSessionMessages: (sessionId, options) => sdk.getSessionMessages(sessionId, options) as Promise<SDKSessionMessage[]>,
    renameSession: (sessionId, title, options) => sdk.renameSession(sessionId, title, options),
    deleteSession: (sessionId, options) => sdk.deleteSession(sessionId, options),
  };
}

function parseToolValue(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

export class AssistantLegacyAdapter {
  private readonly messageCache = new Map<string, SDKSessionMessage[]>();

  constructor(
    private readonly storeFactory: () => Promise<LegacyAssistantStore> = sdkStore,
    private readonly directory = ensureTowerDir(),
  ) {}

  async list(): Promise<Array<DiskSessionInfo & { title: string }>> {
    const store = await this.storeFactory();
    const sessions = await store.listSessions({ dir: this.directory });
    const candidates = sessions
      .filter((session) => legacySessionIdSchema.safeParse(session.sessionId).success)
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, MAX_LEGACY_SESSIONS);
    const visible = await Promise.all(candidates.map(async (session) => {
      let carrier = isAssistantCarrierPrompt(session.firstPrompt);
      if (!carrier && !session.firstPrompt) {
        try {
          const raw = this.messageCache.get(session.sessionId)
            ?? await store.getSessionMessages(session.sessionId, { dir: this.directory });
          this.messageCache.set(session.sessionId, raw);
          const firstUser = convertSessionMessages(raw).find((message) => message.role === "user");
          carrier = isAssistantCarrierPrompt(firstUser?.content);
        } catch {
          // An unreadable session is retained: absence of proof must never delete user history.
        }
      }
      if (!carrier) return { ...session, title: deriveSessionTitle(session) };
      try { await store.deleteSession(session.sessionId, { dir: this.directory }); } catch { /* hidden even if cleanup fails */ }
      this.messageCache.delete(session.sessionId);
      return null;
    }));
    return visible.filter((session): session is DiskSessionInfo & { title: string } => session !== null);
  }

  async import(legacyId: string, service: AssistantSessionService) {
    legacySessionIdSchema.parse(legacyId);
    const existing = await service.findImportedLegacy(legacyId);
    if (existing) return existing;

    const store = await this.storeFactory();
    const metadata = (await store.listSessions({ dir: this.directory }))
      .find((session) => session.sessionId === legacyId);
    if (!metadata) throw new Error("Legacy Assistant session was not found");
    if (isAssistantCarrierPrompt(metadata.firstPrompt)) {
      try { await store.deleteSession(legacyId, { dir: this.directory }); } catch { /* import remains blocked */ }
      this.messageCache.delete(legacyId);
      throw new Error("Tower Assistant carrier sessions cannot be imported");
    }
    // Read first and do not mutate the SDK store. A failed conversion/import leaves
    // the original session byte-for-byte untouched and available for another try.
    const raw = this.messageCache.get(legacyId)
      ?? await store.getSessionMessages(legacyId, { dir: this.directory });
    this.messageCache.set(legacyId, raw);
    const converted = convertSessionMessages(raw);
    if (isAssistantCarrierPrompt(converted.find((message) => message.role === "user")?.content)) {
      try { await store.deleteSession(legacyId, { dir: this.directory }); } catch { /* import remains blocked */ }
      this.messageCache.delete(legacyId);
      throw new Error("Tower Assistant carrier sessions cannot be imported");
    }
    let turn = 0;
    let currentTurn = "legacy-0";
    const fallbackToolIds = new Map<string, string>();
    const messages: Array<{
      role: "USER" | "ASSISTANT" | "SYSTEM";
      parts: AssistantPart[];
      turnKey?: string;
    }> = [];
    for (const message of converted) {
      if (message.role === "thinking") continue;
      if (message.role === "user") {
        currentTurn = `legacy-${++turn}`;
        const parts: AssistantPart[] = [{ type: "text", text: message.content }];
        messages.push({ role: "USER", parts, turnKey: currentTurn });
        continue;
      }
      if (message.role === "assistant") {
        const parts: AssistantPart[] = [{ type: "text", text: message.content }];
        messages.push({ role: "ASSISTANT", parts, turnKey: currentTurn });
        continue;
      }
      const result = message.toolName?.endsWith(" (result)");
      const toolName = (message.toolName ?? "tool").replace(/ \(result\)$/, "");
      let toolCallId = message.toolId;
      if (!toolCallId && result) toolCallId = fallbackToolIds.get(toolName);
      if (!toolCallId) toolCallId = `legacy-tool-${fallbackToolIds.size + 1}`;
      if (!result) fallbackToolIds.set(toolName, toolCallId);
      const parts: AssistantPart[] = result
        ? [{ type: "tool-result", toolCallId, toolName, output: parseToolValue(message.content) }]
        : [{ type: "tool-call", toolCallId, toolName, input: parseToolValue(message.content) }];
      messages.push({ role: "ASSISTANT", parts, turnKey: currentTurn });
    }
    return service.importLegacy({
      legacyId,
      title: deriveSessionTitle(metadata),
      createdAt: new Date(metadata.createdAt ?? metadata.lastModified),
      updatedAt: new Date(metadata.lastModified),
      messages,
    });
  }

  async rename(legacyId: string, title: string): Promise<void> {
    legacySessionIdSchema.parse(legacyId);
    const store = await this.storeFactory();
    await store.renameSession(legacyId, title, { dir: this.directory });
  }

  async delete(legacyId: string): Promise<void> {
    legacySessionIdSchema.parse(legacyId);
    const store = await this.storeFactory();
    await store.deleteSession(legacyId, { dir: this.directory });
    this.messageCache.delete(legacyId);
  }
}

export const assistantLegacyAdapter = new AssistantLegacyAdapter();
