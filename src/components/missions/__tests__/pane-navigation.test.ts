import { describe, it, expect } from "vitest";
import {
  wrapIndex,
  moveSelection,
  paneShortcutLabel,
  paneIndexFromShortcutKey,
} from "../pane-navigation";

describe("wrapIndex", () => {
  it("steps forward within range", () => {
    expect(wrapIndex(0, 4, 1)).toBe(1);
    expect(wrapIndex(2, 4, 1)).toBe(3);
  });

  it("wraps forward past the end to 0", () => {
    expect(wrapIndex(3, 4, 1)).toBe(0);
  });

  it("steps backward within range", () => {
    expect(wrapIndex(2, 4, -1)).toBe(1);
  });

  it("wraps backward past 0 to the last index", () => {
    expect(wrapIndex(0, 4, -1)).toBe(3);
  });

  it("single item stays at 0 in both directions", () => {
    expect(wrapIndex(0, 1, 1)).toBe(0);
    expect(wrapIndex(0, 1, -1)).toBe(0);
  });

  it("empty list returns 0", () => {
    expect(wrapIndex(0, 0, 1)).toBe(0);
    expect(wrapIndex(0, 0, -1)).toBe(0);
  });
});

describe("moveSelection", () => {
  // 2-column grid, 5 items:
  // row0: 0 1
  // row1: 2 3
  // row2: 4
  const cols = 2;
  const len = 5;

  it("right wraps within range", () => {
    expect(moveSelection(0, cols, len, "right")).toBe(1);
    expect(moveSelection(4, cols, len, "right")).toBe(0); // last wraps to 0
  });

  it("left wraps within range", () => {
    expect(moveSelection(0, cols, len, "left")).toBe(4); // 0 wraps to last
    expect(moveSelection(3, cols, len, "left")).toBe(2);
  });

  it("down moves by cols", () => {
    expect(moveSelection(0, cols, len, "down")).toBe(2);
    expect(moveSelection(2, cols, len, "down")).toBe(4);
  });

  it("down clamps (no vertical wrap) when target out of range", () => {
    // from index 3, +2 = 5 (out of range) → stays at 3
    expect(moveSelection(3, cols, len, "down")).toBe(3);
    // from index 4, +2 = 6 (out of range) → stays at 4
    expect(moveSelection(4, cols, len, "down")).toBe(4);
  });

  it("up moves by cols", () => {
    expect(moveSelection(2, cols, len, "up")).toBe(0);
    expect(moveSelection(4, cols, len, "up")).toBe(2);
  });

  it("up clamps (no vertical wrap) when target out of range", () => {
    // from index 0, -2 = -2 (out of range) → stays at 0
    expect(moveSelection(0, cols, len, "up")).toBe(0);
    // from index 1, -2 = -1 (out of range) → stays at 1
    expect(moveSelection(1, cols, len, "up")).toBe(1);
  });

  it("single item stays at 0 for all directions", () => {
    expect(moveSelection(0, cols, 1, "up")).toBe(0);
    expect(moveSelection(0, cols, 1, "down")).toBe(0);
    expect(moveSelection(0, cols, 1, "left")).toBe(0);
    expect(moveSelection(0, cols, 1, "right")).toBe(0);
  });

  it("empty list returns 0", () => {
    expect(moveSelection(0, cols, 0, "up")).toBe(0);
    expect(moveSelection(0, cols, 0, "right")).toBe(0);
  });

  it("treats cols < 1 as 1 (never divides into zero rows)", () => {
    expect(moveSelection(0, 0, len, "down")).toBe(1);
    expect(moveSelection(1, 0, len, "up")).toBe(0);
  });

  it("never returns an out-of-range index", () => {
    for (let i = 0; i < len; i++) {
      for (const dir of ["up", "down", "left", "right"] as const) {
        const r = moveSelection(i, cols, len, dir);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(len);
      }
    }
  });
});

describe("paneShortcutLabel", () => {
  it("maps 0–8 to digits 1–9", () => {
    expect(paneShortcutLabel(0)).toBe("1");
    expect(paneShortcutLabel(8)).toBe("9");
  });

  it("maps 9–34 to letters A–Z", () => {
    expect(paneShortcutLabel(9)).toBe("A");
    expect(paneShortcutLabel(34)).toBe("Z");
  });

  it("returns null beyond the labelled range and for negatives", () => {
    expect(paneShortcutLabel(35)).toBeNull();
    expect(paneShortcutLabel(-1)).toBeNull();
  });
});

describe("paneIndexFromShortcutKey", () => {
  it("maps digits 1–9 to indexes 0–8", () => {
    expect(paneIndexFromShortcutKey("1")).toBe(0);
    expect(paneIndexFromShortcutKey("9")).toBe(8);
  });

  it("maps letters (case-insensitive) to indexes 9–34", () => {
    expect(paneIndexFromShortcutKey("A")).toBe(9);
    expect(paneIndexFromShortcutKey("a")).toBe(9);
    expect(paneIndexFromShortcutKey("z")).toBe(34);
  });

  it("returns null for non-selector keys", () => {
    expect(paneIndexFromShortcutKey("0")).toBeNull();
    expect(paneIndexFromShortcutKey("-")).toBeNull();
    expect(paneIndexFromShortcutKey("Enter")).toBeNull();
    expect(paneIndexFromShortcutKey("")).toBeNull();
  });

  it("round-trips with paneShortcutLabel", () => {
    for (let i = 0; i < 35; i++) {
      const label = paneShortcutLabel(i)!;
      expect(paneIndexFromShortcutKey(label)).toBe(i);
    }
  });
});
