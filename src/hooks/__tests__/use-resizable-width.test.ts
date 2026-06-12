import { describe, it, expect } from "vitest";
import { clampWidth, computeWidth } from "@/hooks/use-resizable-width";

describe("clampWidth", () => {
  it("returns the value when within range", () => {
    expect(clampWidth(300, 240, 560)).toBe(300);
  });

  it("clamps to the minimum", () => {
    expect(clampWidth(100, 240, 560)).toBe(240);
  });

  it("clamps to the maximum", () => {
    expect(clampWidth(9999, 240, 560)).toBe(560);
  });
});

describe("computeWidth", () => {
  it("grows a left-edge (right-docked) panel when dragging left", () => {
    // pointer moved 50px left from start → width grows by 50
    expect(computeWidth(300, 500, 450, 240, 560, "left")).toBe(350);
  });

  it("shrinks a left-edge panel when dragging right", () => {
    expect(computeWidth(300, 500, 560, 240, 560, "left")).toBe(240);
  });

  it("mirrors direction for a right-edge panel", () => {
    // dragging right grows a right-edge panel
    expect(computeWidth(300, 500, 550, 240, 560, "right")).toBe(350);
  });

  it("clamps the computed width to max", () => {
    expect(computeWidth(500, 500, 300, 240, 560, "left")).toBe(560);
  });

  it("clamps the computed width to min", () => {
    expect(computeWidth(260, 500, 600, 240, 560, "left")).toBe(240);
  });

  it("defaults to a left edge", () => {
    expect(computeWidth(300, 500, 450, 240, 560)).toBe(350);
  });
});
