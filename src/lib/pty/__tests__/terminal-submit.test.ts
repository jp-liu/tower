import { describe, it, expect } from "vitest";
import { planTerminalWrite, hexTail } from "../terminal-submit";

describe("planTerminalWrite", () => {
  it("submits a plain message via a standalone CR", () => {
    expect(planTerminalWrite("hello", true)).toEqual({ body: "hello", submitKey: "\r" });
  });

  it("strips trailing newlines so the CR is not glued to the text", () => {
    // Regression: a glued trailing newline is what made the Feishu message only
    // fill the box without submitting. The body must carry no trailing CR/LF.
    expect(planTerminalWrite("hello\n\n", true)).toEqual({ body: "hello", submitKey: "\r" });
    expect(planTerminalWrite("hello\r\n", true)).toEqual({ body: "hello", submitKey: "\r" });
    expect(planTerminalWrite("hello\r", true)).toEqual({ body: "hello", submitKey: "\r" });
  });

  it("preserves interior newlines but still submits with a CR", () => {
    expect(planTerminalWrite("line1\nline2\n", true)).toEqual({
      body: "line1\nline2",
      submitKey: "\r",
    });
  });

  it("treats a newline-only message as a bare Enter", () => {
    expect(planTerminalWrite("\n", true)).toEqual({ body: "", submitKey: "\r" });
  });

  it("forwards text verbatim with no submit when submit is false", () => {
    expect(planTerminalWrite("hello\n", false)).toEqual({ body: "hello\n", submitKey: null });
  });
});

describe("hexTail", () => {
  it("renders the trailing bytes as hex — exposes a real CR (0d)", () => {
    expect(hexTail("hello\r")).toContain("0d");
  });

  it("distinguishes a newline (0a) from a carriage return (0d)", () => {
    expect(hexTail("x\n")).toContain("0a");
    expect(hexTail("x\r")).toContain("0d");
  });
});
