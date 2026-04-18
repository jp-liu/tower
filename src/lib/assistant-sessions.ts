export interface AssistantSession {
  id: string;       // UUID / SDK session ID
  title: string;    // First user message truncated to 30 chars, or "New Session"
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}

const STORAGE_KEY = "tower-assistant-sessions";
const ACTIVE_KEY = "tower-assistant-active-session";
const MAX_SESSIONS = 20;

export function getSessions(): AssistantSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as AssistantSession[];
  } catch {
    return [];
  }
}

export function addSession(session: AssistantSession): void {
  if (typeof window === "undefined") return;
  const existing = getSessions();
  // Prepend and cap at MAX_SESSIONS
  const updated = [session, ...existing.filter((s) => s.id !== session.id)].slice(0, MAX_SESSIONS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function updateSession(id: string, updates: Partial<AssistantSession>): void {
  if (typeof window === "undefined") return;
  const existing = getSessions();
  const updated = existing.map((s) =>
    s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function deleteSession(id: string): void {
  if (typeof window === "undefined") return;
  const existing = getSessions();
  const updated = existing.filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  // If we deleted the active session, clear active
  if (getActiveSessionId() === id) {
    setActiveSessionId(null);
  }
}

export function getActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveSessionId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id === null) {
    localStorage.removeItem(ACTIVE_KEY);
  } else {
    localStorage.setItem(ACTIVE_KEY, id);
  }
}

/**
 * Build a session title from the first user message.
 * Truncates to 30 characters.
 */
export function buildSessionTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim();
  if (!trimmed) return "New Session";
  return trimmed.length > 30 ? trimmed.slice(0, 30) : trimmed;
}
