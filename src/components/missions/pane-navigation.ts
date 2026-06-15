/**
 * Pure index math for Mission Control pane navigation.
 *
 * All functions are side-effect free and never return an out-of-range index
 * for a non-empty list. For an empty list (`len <= 0`) they return 0.
 */

export type MoveDirection = "up" | "down" | "left" | "right";

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
