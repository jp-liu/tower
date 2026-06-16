"use client";

import { useShortcutStore, selectAllShortcuts } from "./shortcut-store";
import type { RegisteredShortcut } from "./types";

/** SSR-safe macOS detection. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  // Fall back to userAgent (navigator.platform is deprecated).
  return /mac/i.test(uaPlatform ?? navigator.userAgent ?? "");
}

const ARROW_SYMBOLS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

/** Convert a single token (between `+`) to a human-readable symbol. */
function renderToken(token: string, mac: boolean): string {
  switch (token) {
    case "$mod":
    case "Meta":
      return mac ? "⌘" : "Ctrl";
    case "Control":
      return "Ctrl";
    case "Alt":
      return mac ? "⌥" : "Alt";
    case "Shift":
      return "⇧";
    case "Escape":
      return "Esc";
    case "Enter":
      return "↵";
    case "Tab":
      return "Tab";
    default:
      // event.code digit bindings (e.g. "Digit1") → bare number "1".
      if (/^Digit[0-9]$/.test(token)) return token.slice(5);
      return ARROW_SYMBOLS[token] ?? token;
  }
}

/** Split a single tinykeys combo into its rendered, human-readable tokens. */
export function renderComboTokens(combo: string): string[] {
  const mac = isMac();
  return combo.split("+").map((token) => renderToken(token, mac));
}

/**
 * Collapse a run of bindings that differ only by a trailing digit 1..N into a
 * single range binding (e.g. `["1".."9"]` → `["1–9"]`, `["Alt+Digit1"..]` →
 * `["Alt+1–9"]`). Keeps the list unchanged when it isn't a clean 1..N run.
 */
export function compactKeyList(keys: string[]): string[] {
  if (keys.length < 3) return keys;
  const parsed = keys.map((k) => {
    const m = /^(.*?)(?:Digit)?([1-9])$/.exec(k);
    return m ? { prefix: m[1], digit: Number(m[2]) } : null;
  });
  if (parsed.some((p) => p === null)) return keys;
  const prefix = parsed[0]!.prefix;
  const ok =
    parsed.every((p) => p!.prefix === prefix) &&
    parsed.every((p, i) => p!.digit === i + 1);
  if (!ok) return keys;
  return [`${prefix}1–${parsed[parsed.length - 1]!.digit}`];
}

/** Convert a list of tinykeys binding strings to human-readable combos (`+`-joined). */
export function renderKeys(keys: string[]): string[] {
  return keys.map((combo) => renderComboTokens(combo).join("+"));
}

export interface ShortcutHelpGroup {
  /** Group title — the binding's `group`, falling back to `scope`. */
  title: string;
  shortcuts: RegisteredShortcut[];
}

/**
 * Read the registry for the Cheatsheet: non-hidden entries grouped by
 * `group ?? scope`. Returns groups plus the `renderKeys` helper.
 */
export function useShortcutHelp(): {
  groups: ShortcutHelpGroup[];
  renderKeys: (keys: string[]) => string[];
} {
  const entries = useShortcutStore(selectAllShortcuts);

  const byGroup = new Map<string, RegisteredShortcut[]>();
  for (const entry of entries) {
    if (entry.hidden) continue;
    const title = entry.group ?? entry.scope ?? "global";
    const list = byGroup.get(title);
    if (list) list.push(entry);
    else byGroup.set(title, [entry]);
  }

  const groups: ShortcutHelpGroup[] = Array.from(byGroup.entries()).map(
    ([title, shortcuts]) => ({ title, shortcuts })
  );

  return { groups, renderKeys };
}
