import { describe, expect, it } from "vitest";
import { mergeMissions } from "../merge-missions";

interface ExecutionFixture {
  executionId: string;
  state: string;
}

describe("mergeMissions", () => {
  it("refreshes data for an execution that is already displayed", () => {
    const previous: ExecutionFixture = { executionId: "execution-1", state: "STALE" };
    const fresh: ExecutionFixture = { executionId: "execution-1", state: "IDLE" };

    expect(mergeMissions({
      prev: [previous],
      fresh: [fresh],
      removingIds: new Set(),
    })).toEqual({
      merged: [fresh],
      goneIds: [],
    });
  });

  it("preserves displayed order while appending new executions", () => {
    const first = { executionId: "execution-1", state: "BUSY" };
    const second = { executionId: "execution-2", state: "IDLE" };
    const added = { executionId: "execution-3", state: "STARTING" };

    expect(mergeMissions({
      prev: [first, second],
      fresh: [second, first, added],
      removingIds: new Set(),
    }).merged).toEqual([first, second, added]);
  });

  it("keeps a disappearing execution unchanged until its removal animation ends", () => {
    const removing = { executionId: "execution-1", state: "IDLE" };

    expect(mergeMissions({
      prev: [removing],
      fresh: [],
      removingIds: new Set([removing.executionId]),
    })).toEqual({
      merged: [removing],
      goneIds: [],
    });
  });

  it("reports executions that disappeared before removal starts", () => {
    expect(mergeMissions({
      prev: [{ executionId: "execution-1", state: "IDLE" }],
      fresh: [],
      removingIds: new Set(),
    })).toEqual({
      merged: [],
      goneIds: ["execution-1"],
    });
  });
});
