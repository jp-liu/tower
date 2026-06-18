// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  hasBugSignature,
  isUnderRoot,
} from "../../../scripts/migrations/0004-relocate-misplaced-assets";

describe("hasBugSignature (asset relocation — bug victim detection)", () => {
  it("matches the create_task bug paths (…/data/assets/…)", () => {
    expect(hasBugSignature("/Users/me/project/data/assets/p1/a.png")).toBe(true);
    expect(hasBugSignature("/usr/local/lib/node_modules/tower/data/assets/p1/a.png")).toBe(true);
    // Windows global install (backslash separators)
    expect(hasBugSignature("C:\\Users\\me\\AppData\\npm\\node_modules\\tower\\data\\assets\\p1\\a.png")).toBe(true);
  });

  it("does NOT match the correct storage layout (…/storage/assets/…)", () => {
    expect(hasBugSignature("/Users/me/.tower/storage/assets/p1/a.png")).toBe(false);
    expect(hasBugSignature("/Users/me/.tower-dev/storage/assets/p1/a.png")).toBe(false);
    expect(hasBugSignature("C:\\Users\\me\\.tower\\storage\\assets\\p1\\a.png")).toBe(false);
    // A custom storage location chosen in Settings — still "storage/assets".
    expect(hasBugSignature("/mnt/data/tower-storage/assets/p1/a.png")).toBe(false);
  });

  it("does not false-positive on unrelated paths containing the words apart", () => {
    expect(hasBugSignature("/var/data/something/assets-cache/x.png")).toBe(false);
    expect(hasBugSignature("/home/u/my-data/assets/x.png")).toBe(false); // not "/data/assets/"
  });
});

describe("isUnderRoot", () => {
  it("is true only for paths inside the assets root", () => {
    const root = "/Users/me/.tower/storage/assets";
    expect(isUnderRoot("/Users/me/.tower/storage/assets/p1/a.png", root)).toBe(true);
    expect(isUnderRoot("/Users/me/.tower-dev/storage/assets/p1/a.png", root)).toBe(false);
    expect(isUnderRoot("/Users/me/project/data/assets/p1/a.png", root)).toBe(false);
  });

  it("does not treat a sibling prefix as inside the root", () => {
    const root = "/Users/me/.tower/storage/assets";
    // "assets-old" shares the string prefix but is not under the root dir
    expect(isUnderRoot("/Users/me/.tower/storage/assets-old/a.png", root)).toBe(false);
  });
});
