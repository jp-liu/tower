import { isMac } from "./use-shortcut-help";

/**
 * Convert a captured `keydown` event into a tinykeys binding string.
 *
 * Returns `null` for a bare modifier press (the key itself is a modifier), so a
 * key-capture UI can ignore those and wait for the full combo.
 *
 * Modifier mapping:
 * - The platform "command" modifier → `$mod` (mac: metaKey; else: ctrlKey).
 * - The other of ctrl/meta → explicit (`Control` on mac when ctrlKey is down,
 *   `Meta` elsewhere when metaKey is down).
 * - `Alt` → `Alt`, `Shift` → `Shift`.
 *
 * Token order: `$mod`, `Control`/`Meta`, `Alt`, `Shift`, then the key.
 * Single letters are lowercased; everything else uses `e.key` verbatim
 * (e.g. `;`, `]`, `ArrowLeft`, `Enter`).
 */
export function serializeKeyEvent(e: KeyboardEvent): string | null {
  const { key } = e;
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") {
    return null;
  }

  const mac = isMac();
  const tokens: string[] = [];

  // Platform "command" modifier → $mod.
  const cmdDown = mac ? e.metaKey : e.ctrlKey;
  if (cmdDown) tokens.push("$mod");

  // The other of ctrl/meta → explicit.
  const otherDown = mac ? e.ctrlKey : e.metaKey;
  if (otherDown) tokens.push(mac ? "Control" : "Meta");

  if (e.altKey) tokens.push("Alt");
  if (e.shiftKey) tokens.push("Shift");

  const keyToken =
    key.length === 1 && /[a-zA-Z]/.test(key) ? key.toLowerCase() : key;
  tokens.push(keyToken);

  return tokens.join("+");
}

/** Format a list of tinykeys binding strings for display. Delegates to `renderKeys`. */
export { renderKeys as formatKeysList } from "./use-shortcut-help";
