import { describe, it, expect } from "vitest";
import { upsertMarkedBlock } from "../group-doc";

const START = "# Tower Config Env Start";
const END = "# Tower Config Env End";
const withBlock = (body: string) => `${START}\n${body}\n${END}`;

describe("upsertMarkedBlock", () => {
  it("replaces only the marked body, leaving user content untouched", () => {
    const content = `mine above\n\n${withBlock("old")}\n\nmine below\n`;
    const next = upsertMarkedBlock(content, "new");
    expect(next).toBe(`mine above\n\n${withBlock("new")}\n\nmine below\n`);
  });

  it("appends the block when no markers exist", () => {
    expect(upsertMarkedBlock("mine\n", "body")).toBe(`mine\n\n${withBlock("body")}\n`);
  });

  it("removes the block without leaving residue", () => {
    const next = upsertMarkedBlock(`mine\n\n${withBlock("body")}\n`, null);
    expect(next).toBe("mine\n");
    expect(next).not.toContain("Tower Config Env");
  });

  it("empties a file that held nothing but the block (caller deletes it)", () => {
    expect(upsertMarkedBlock(`${withBlock("body")}\n`, null)).toBe("");
  });
});
