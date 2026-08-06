export const DEFAULT_ASSISTANT_HISTORY_TURNS = 5;
export const MIN_ASSISTANT_HISTORY_TURNS = 1;
export const MAX_ASSISTANT_HISTORY_TURNS = 20;

export function normalizeAssistantHistoryTurns(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_ASSISTANT_HISTORY_TURNS;
  return Math.min(MAX_ASSISTANT_HISTORY_TURNS, Math.max(MIN_ASSISTANT_HISTORY_TURNS, Math.trunc(value)));
}
