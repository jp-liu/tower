import { describe, it, expect } from "vitest";
import { getInitials } from "../top-bar";

describe("getInitials", () => {
  it("returns single initial for a single name", () => {
    expect(getInitials("Alice")).toBe("A");
  });

  it("returns two initials for a full name", () => {
    expect(getInitials("Alice Bob")).toBe("AB");
  });

  it("limits to max 2 chars for a three-word name", () => {
    expect(getInitials("Alice Bob Charlie")).toBe("AB");
  });

  it("returns empty string for empty input", () => {
    expect(getInitials("")).toBe("");
  });

  it("trims whitespace and returns initials", () => {
    expect(getInitials("  spaced  name  ")).toBe("SN");
  });
});
