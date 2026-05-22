import { describe, it, expect } from "vitest";
import { extractUrl, stripAnsi } from "@/lib/preview/url-extractor";

describe("stripAnsi", () => {
  it("removes ANSI escape sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m text")).toBe("red text");
  });

  it("leaves plain text unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });
});

describe("extractUrl", () => {
  it("extracts first http URL", () => {
    expect(extractUrl("Local: http://localhost:5173/")).toBe(
      "http://localhost:5173/"
    );
  });

  it("extracts https URL", () => {
    expect(extractUrl("→ https://example.com/path")).toBe(
      "https://example.com/path"
    );
  });

  it("handles ANSI-wrapped URLs", () => {
    expect(extractUrl("\x1b[36m  http://localhost:5173/\x1b[0m")).toBe(
      "http://localhost:5173/"
    );
  });

  it("returns null when no URL present", () => {
    expect(extractUrl("no urls here")).toBeNull();
  });

  it("uses custom extractRegex when provided", () => {
    const m = extractUrl(
      "Local:   http://localhost:5173/",
      /Local:\s+(https?:\/\/[^\s]+)/
    );
    expect(m).toBe("http://localhost:5173/");
  });
});
