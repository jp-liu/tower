import { describe, it, expect } from "vitest";
import { getExtension, listExtensions } from "../registry";

describe("registry", () => {
  it("getExtension('rg') returns the rg extension", () => {
    const ext = getExtension("rg");
    expect(ext?.id).toBe("rg");
    expect(ext?.name).toMatch(/搜索|ripgrep/i);
  });

  it("getExtension('monaco') returns the monaco extension", () => {
    const ext = getExtension("monaco");
    expect(ext?.id).toBe("monaco");
    expect(ext?.name).toMatch(/编辑|monaco/i);
  });

  it("getExtension with unknown id returns null", () => {
    // @ts-expect-error testing runtime safety against bad id
    expect(getExtension("bogus")).toBeNull();
  });

  it("listExtensions returns both definitions in deterministic order", () => {
    const list = listExtensions();
    expect(list.length).toBe(2);
    expect(list.map((e) => e.id)).toEqual(["rg", "monaco"]);
  });
});
