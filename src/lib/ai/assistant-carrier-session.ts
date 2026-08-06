const HISTORY_HEADER = "Conversation history (Tower is the source of truth):";
const CURRENT_USER_HEADER = "CURRENT USER:";

/** Matches the exact flattened prompt envelope used only for stateless CLI Assistant requests. */
export function isAssistantCarrierPrompt(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const prompt = value.trim();
  if (prompt.startsWith(`${CURRENT_USER_HEADER} `)) return true;
  return prompt.startsWith(`${HISTORY_HEADER}\n`)
    && prompt.includes(`\n\n${CURRENT_USER_HEADER} `);
}
