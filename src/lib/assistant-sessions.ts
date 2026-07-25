export interface SessionBinding {
  workspaceId?: string;
  workspaceName?: string;
  projectId?: string;
  projectName?: string;
  versionId?: string;
  versionName?: string;
}

export interface AssistantSession extends SessionBinding {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  legacy?: boolean;
}

const STORAGE_KEY = "tower-assistant-sessions";
const ACTIVE_KEY = "tower-assistant-active-session";
const BINDING_KEY = "tower-assistant-bindings";
const SESSION_ID_RE = /^(?:as_[0-9a-f-]{36}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export interface LegacyAssistantOverlay {
  sessions: AssistantSession[];
  bindings: Record<string, SessionBinding>;
}

function safeString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

function safeBinding(value: unknown): SessionBinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const binding: SessionBinding = {};
  for (const key of ["workspaceId", "projectId", "versionId"] as const) {
    const entry = safeString(input[key], 128);
    if (entry) binding[key] = entry;
  }
  for (const key of ["workspaceName", "projectName", "versionName"] as const) {
    const entry = safeString(input[key], 256);
    if (entry !== undefined) binding[key] = entry;
  }
  return binding;
}

/** Upgrade-only reader. DB responses are authoritative after this overlay is applied. */
export function readLegacyAssistantOverlay(): LegacyAssistantOverlay {
  if (typeof window === "undefined") return { sessions: [], bindings: {} };
  try {
    const rawSessions: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    const rawBindings: unknown = JSON.parse(localStorage.getItem(BINDING_KEY) ?? "{}");
    const sessions = Array.isArray(rawSessions) ? rawSessions.flatMap((value): AssistantSession[] => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const input = value as Record<string, unknown>;
      const id = safeString(input.id, 64);
      const title = safeString(input.title, 120);
      const createdAt = safeString(input.createdAt, 64);
      const updatedAt = safeString(input.updatedAt, 64);
      if (!id || !SESSION_ID_RE.test(id) || !title || !createdAt || !updatedAt) return [];
      return [{ id, title, createdAt, updatedAt }];
    }) : [];
    const bindings = rawBindings && typeof rawBindings === "object" && !Array.isArray(rawBindings)
      ? Object.fromEntries(Object.entries(rawBindings).flatMap(([id, value]) => {
          const binding = SESSION_ID_RE.test(id) ? safeBinding(value) : undefined;
          return binding ? [[id, binding]] : [];
        }))
      : {};
    return {
      sessions,
      bindings,
    };
  } catch {
    return { sessions: [], bindings: {} };
  }
}

export function clearLegacyAssistantOverlay(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(BINDING_KEY);
}

export function getActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveSessionId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id === null) localStorage.removeItem(ACTIVE_KEY);
  else localStorage.setItem(ACTIVE_KEY, id);
}
