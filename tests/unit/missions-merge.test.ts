// @vitest-environment node
import { describe, it, expect } from "vitest";

// Pure function: merge fresh poll results into existing ordered card list
// This will be extracted to a util in Plan 02 Task 2
interface MergeInput {
  prev: { executionId: string }[];
  fresh: { executionId: string }[];
  removingIds: Set<string>;
}

function mergeMissions({ prev, fresh, removingIds }: MergeInput) {
  const freshIds = new Set(fresh.map((e) => e.executionId));
  const goneIds: string[] = [];
  prev.forEach((c) => {
    if (!freshIds.has(c.executionId) && !removingIds.has(c.executionId)) {
      goneIds.push(c.executionId);
    }
  });
  const retained = prev.filter(
    (c) => freshIds.has(c.executionId) || removingIds.has(c.executionId)
  );
  const prevIds = new Set(prev.map((c) => c.executionId));
  const added = fresh.filter((e) => !prevIds.has(e.executionId));
  return { merged: [...retained, ...added], goneIds };
}

describe("mergeMissions", () => {
  it("retains existing order when no changes", () => {
    const prev = [{ executionId: "A" }, { executionId: "B" }, { executionId: "C" }];
    const fresh = [{ executionId: "A" }, { executionId: "B" }, { executionId: "C" }];
    const { merged, goneIds } = mergeMissions({ prev, fresh, removingIds: new Set() });
    expect(merged.map((e) => e.executionId)).toEqual(["A", "B", "C"]);
    expect(goneIds).toEqual([]);
  });

  it("appends new executions at end", () => {
    const prev = [{ executionId: "A" }, { executionId: "B" }];
    const fresh = [{ executionId: "A" }, { executionId: "B" }, { executionId: "C" }];
    const { merged } = mergeMissions({ prev, fresh, removingIds: new Set() });
    expect(merged.map((e) => e.executionId)).toEqual(["A", "B", "C"]);
  });

  it("detects gone executions", () => {
    const prev = [{ executionId: "A" }, { executionId: "B" }, { executionId: "C" }];
    const fresh = [{ executionId: "A" }, { executionId: "C" }];
    const { goneIds } = mergeMissions({ prev, fresh, removingIds: new Set() });
    expect(goneIds).toEqual(["B"]);
  });

  it("preserves removing cards (not counted as gone)", () => {
    const prev = [{ executionId: "A" }, { executionId: "B" }];
    const fresh = [{ executionId: "A" }];
    const { merged, goneIds } = mergeMissions({ prev, fresh, removingIds: new Set(["B"]) });
    expect(merged.map((e) => e.executionId)).toEqual(["A", "B"]);
    expect(goneIds).toEqual([]);
  });

  it("handles empty prev", () => {
    const prev: { executionId: string }[] = [];
    const fresh = [{ executionId: "A" }, { executionId: "B" }];
    const { merged, goneIds } = mergeMissions({ prev, fresh, removingIds: new Set() });
    expect(merged.map((e) => e.executionId)).toEqual(["A", "B"]);
    expect(goneIds).toEqual([]);
  });
});
