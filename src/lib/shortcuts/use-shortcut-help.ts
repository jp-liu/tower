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
    default:
      return ARROW_SYMBOLS[token] ?? token;
  }
}

/** Convert a list of tinykeys binding strings to human-readable combos. */
export function renderKeys(keys: string[]): string[] {
  const mac = isMac();
  return keys.map((combo) =>
    combo
      .split("+")
      .map((token) => renderToken(token, mac))
      .join(mac ? "" : "+")
  );
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
