// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mergeMissions } from "@/components/missions/merge-missions";

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
