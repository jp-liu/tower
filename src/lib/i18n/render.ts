import { en } from "./en";
import type { TranslationKey } from "./types";

/** A message resolved by its consumer: UI renders it via `t()` (follows the
 *  user's locale), server/MCP via {@link renderEn} (always English for agents). */
export interface I18nMessage {
  key: TranslationKey;
  vars?: Record<string, string>;
}

/**
 * Renders a translation key to English, outside of React.
 *
 * The i18n context (`i18n.tsx`) is `"use client"`, so server code and the MCP
 * stdio process cannot use its `t()`. This is the English-only equivalent, with
 * the same `{var}` substitution semantics — importing only the plain `en`
 * dictionary object, so no client module is dragged into a server bundle.
 */
export function renderEn(key: TranslationKey, vars?: Record<string, string>): string {
  let str: string = en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, v);
    }
  }
  return str;
}
