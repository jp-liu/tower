import { describe, it, expect } from "vitest";
import { selectExpiredPreviewKeys } from "@/lib/preview/session-store";

const GRACE = 5 * 60 * 1000;

describe("selectExpiredPreviewKeys", () => {
  it("does not evict on first sight — starts the grace clock instead", () => {
    const seenAt = new Map<string, number>();
    const expired = selectExpiredPreviewKeys([{ key: "a", evictable: true }], seenAt, 1000, GRACE);
    expect(expired).toEqual([]);
    expect(seenAt.get("a")).toBe(1000);
  });

  it("evicts once continuously evictable for >= grace", () => {
    const seenAt = new Map<string, number>([["a", 1000]]);
    const expired = selectExpiredPreviewKeys([{ key: "a", evictable: true }], seenAt, 1000 + GRACE, GRACE);
    expect(expired).toEqual(["a"]);
  });

  it("does not evict before grace elapses", () => {
    const seenAt = new Map<string, number>([["a", 1000]]);
    const expired = selectExpiredPreviewKeys([{ key: "a", evictable: true }], seenAt, 1000 + GRACE - 1, GRACE);
    expect(expired).toEqual([]);
  });

  it("clears the clock when a session becomes non-evictable again (revived/watched)", () => {
    const seenAt = new Map<string, number>([["a", 1000]]);
    const expired = selectExpiredPreviewKeys([{ key: "a", evictable: false }], seenAt, 1000 + GRACE, GRACE);
    expect(expired).toEqual([]);
    expect(seenAt.has("a")).toBe(false); // grace reset — reopening then re-dying gets a fresh window
  });
});
