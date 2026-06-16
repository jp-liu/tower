/**
 * Pure index math for Mission Control pane navigation.
 *
 * All functions are side-effect free and never return an out-of-range index
 * for a non-empty list. For an empty list (`len <= 0`) they return 0.
 */

export type MoveDirection = "up" | "down" | "left" | "right";

/**
 * Shortcut characters for the pane selector, in order: digits 1–9, then A–Z.
 * Index 0 → "1", … index 8 → "9", index 9 → "A", … index 34 → "Z".
 * Panes beyond index 34 have no quick-select key (mouse click still works).
 */
export const PANE_SHORTCUT_CHARS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The shortcut label for a pane index, or `null` when out of the labelled range. */
export function paneShortcutLabel(index: number): string | null {
  if (index < 0 || index >= PANE_SHORTCUT_CHARS.length) return null;
  return PANE_SHORTCUT_CHARS[index];
}

/**
 * Map a pressed key (e.g. "3", "a", "A") to its pane index, or `null` when the
 * key is not a valid selector character. Letters are case-insensitive.
 */
export function paneIndexFromShortcutKey(key: string): number | null {
  if (key.length !== 1) return null;
  const i = PANE_SHORTCUT_CHARS.indexOf(key.toUpperCase());
  return i === -1 ? null : i;
}

/**
 * Wrap-around index step. Moving forward past the end wraps to 0; moving
 * backward past 0 wraps to the last index.
 */
export function wrapIndex(cur: number, len: number, dir: 1 | -1): number {
  if (len <= 0) return 0;
  return (((cur + dir) % len) + len) % len;
}

/**
 * Grid-aware selection move.
 *
 * - left / right: ±1 with horizontal wrap within [0, len).
 * - up / down: ±cols with vertical CLAMP (never wraps; stays in range).
 *
 * Always returns an in-range index for a non-empty list.
 */
export function moveSelection(
  cur: number,
  cols: number,
  len: number,
  dir: MoveDirection
): number {
  if (len <= 0) return 0;
  const safeCols = Math.max(1, cols);

  switch (dir) {
    case "left":
      return wrapIndex(cur, len, -1);
    case "right":
      return wrapIndex(cur, len, 1);
    case "up": {
      const target = cur - safeCols;
      return target < 0 ? cur : target;
    }
    case "down": {
      const target = cur + safeCols;
      return target >= len ? cur : target;
    }
    default:
      return cur;
  }
}
