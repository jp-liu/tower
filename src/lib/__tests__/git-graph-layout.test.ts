import { describe, it, expect } from "vitest";
import { layoutGraph, RawCommit } from "../git-graph-layout";

const PALETTE = [
  "#3fb950", "#58a6ff", "#f78166", "#d2a8ff",
  "#ffa657", "#7ee787", "#79c0ff", "#ff7b72",
];

// ── Fixture A: Linear chain (no branches) ──────────────────────────────────
// C ← B ← A   (newest-first)
const linear: RawCommit[] = [
  { hash: "C", shortHash: "C", parents: ["B"], author: "x", date: "", subject: "", refs: [] },
  { hash: "B", shortHash: "B", parents: ["A"], author: "x", date: "", subject: "", refs: [] },
  { hash: "A", shortHash: "A", parents: [],    author: "x", date: "", subject: "", refs: [] },
];

// ── Fixture B: Branch + merge ──────────────────────────────────────────────
// main:   A → C → D (merge)
// branch: A → B
// newest-first: D (parents [C, B]), C (parent [A]), B (parent [A]), A (root [])
const branchMerge: RawCommit[] = [
  { hash: "D", shortHash: "D", parents: ["C", "B"], author: "x", date: "", subject: "", refs: [] },
  { hash: "C", shortHash: "C", parents: ["A"],      author: "x", date: "", subject: "", refs: [] },
  { hash: "B", shortHash: "B", parents: ["A"],      author: "x", date: "", subject: "", refs: [] },
  { hash: "A", shortHash: "A", parents: [],         author: "x", date: "", subject: "", refs: [] },
];

// ── Fixture C: Lane recycling ──────────────────────────────────────────────
// After branch fully merges back, its lane should be reusable.
// newest-first: F (parent [E]), E (merge, parents [D, B]), D (parent [C]),
//               C (parent [A]), B (parent [A]), A (root)
const laneRecycling: RawCommit[] = [
  { hash: "F", shortHash: "F", parents: ["E"],      author: "x", date: "", subject: "", refs: [] },
  { hash: "E", shortHash: "E", parents: ["D", "B"], author: "x", date: "", subject: "", refs: [] },
  { hash: "D", shortHash: "D", parents: ["C"],      author: "x", date: "", subject: "", refs: [] },
  { hash: "C", shortHash: "C", parents: ["A"],      author: "x", date: "", subject: "", refs: [] },
  { hash: "B", shortHash: "B", parents: ["A"],      author: "x", date: "", subject: "", refs: [] },
  { hash: "A", shortHash: "A", parents: [],         author: "x", date: "", subject: "", refs: [] },
];

// ── Fixture D: Octopus merge (3 parents) ──────────────────────────────────
// X with parents [A, B, C], then A, B, C as separate roots.
const octopus: RawCommit[] = [
  { hash: "X", shortHash: "X", parents: ["A", "B", "C"], author: "x", date: "", subject: "", refs: [] },
  { hash: "A", shortHash: "A", parents: [],               author: "x", date: "", subject: "", refs: [] },
  { hash: "B", shortHash: "B", parents: [],               author: "x", date: "", subject: "", refs: [] },
  { hash: "C", shortHash: "C", parents: [],               author: "x", date: "", subject: "", refs: [] },
];

// ── Fixture F: Parent outside window ──────────────────────────────────────
// B's parent is "A" but A is NOT in the input list.
const parentOutsideWindow: RawCommit[] = [
  { hash: "B", shortHash: "B", parents: ["A"], author: "x", date: "", subject: "", refs: [] },
];

describe("layoutGraph", () => {
  // ── Fixture A tests ───────────────────────────────────────────────────────

  it("Fixture A: linear chain — all commits on lane 0", () => {
    const result = layoutGraph(linear);
    expect(result.commits).toHaveLength(3);
    for (const c of result.commits) {
      expect(c.lane).toBe(0);
    }
  });

  it("Fixture A: linear chain — rows are 0,1,2 top-to-bottom", () => {
    const result = layoutGraph(linear);
    expect(result.commits[0].row).toBe(0); // C is newest → row 0
    expect(result.commits[1].row).toBe(1); // B
    expect(result.commits[2].row).toBe(2); // A
  });

  it("Fixture A: linear chain — 2 edges and laneCount === 1", () => {
    const result = layoutGraph(linear);
    expect(result.laneCount).toBe(1);
    expect(result.edges).toHaveLength(2);
  });

  it("Fixture A: linear chain — edges connect correct rows", () => {
    const result = layoutGraph(linear);
    // C (row 0, lane 0) → B (row 1, lane 0)
    expect(result.edges).toContainEqual({
      fromLane: 0, fromRow: 0,
      toLane:   0, toRow:   1,
      color:    PALETTE[0],
    });
    // B (row 1, lane 0) → A (row 2, lane 0)
    expect(result.edges).toContainEqual({
      fromLane: 0, fromRow: 1,
      toLane:   0, toRow:   2,
      color:    PALETTE[0],
    });
  });

  it("Fixture A: linear chain — lane 0 color equals PALETTE[0]", () => {
    const result = layoutGraph(linear);
    for (const c of result.commits) {
      expect(c.color).toBe(PALETTE[0]);
    }
  });

  // ── Fixture B tests ───────────────────────────────────────────────────────

  it("Fixture B: branch+merge — D and C on lane 0, B on lane 1, A on lane 0", () => {
    const result = layoutGraph(branchMerge);
    const byHash = Object.fromEntries(result.commits.map((c) => [c.hash, c]));
    expect(byHash["D"].lane).toBe(0);
    expect(byHash["C"].lane).toBe(0);
    expect(byHash["B"].lane).toBe(1);
    expect(byHash["A"].lane).toBe(0);
  });

  it("Fixture B: branch+merge — 4 edges total", () => {
    const result = layoutGraph(branchMerge);
    expect(result.edges).toHaveLength(4);
  });

  it("Fixture B: branch+merge — laneCount === 2", () => {
    const result = layoutGraph(branchMerge);
    expect(result.laneCount).toBe(2);
  });

  it("Fixture B: branch+merge — edge D→C has correct properties", () => {
    const result = layoutGraph(branchMerge);
    const byHash = Object.fromEntries(result.commits.map((c) => [c.hash, c]));
    const d = byHash["D"];
    const c = byHash["C"];
    const edge = result.edges.find(
      (e) => e.fromRow === d.row && e.toLane === c.lane && e.toRow === c.row
    );
    expect(edge).toBeDefined();
    expect(edge!.fromLane).toBe(d.lane);
    expect(edge!.color).toBe(d.color);
  });

  it("Fixture B: branch+merge — edge D→B has correct properties", () => {
    const result = layoutGraph(branchMerge);
    const byHash = Object.fromEntries(result.commits.map((c) => [c.hash, c]));
    const d = byHash["D"];
    const b = byHash["B"];
    const edge = result.edges.find(
      (e) => e.fromRow === d.row && e.toLane === b.lane && e.toRow === b.row
    );
    expect(edge).toBeDefined();
    expect(edge!.color).toBe(d.color);
  });

  it("Fixture B: branch+merge — lane 0 = PALETTE[0], lane 1 = PALETTE[1]", () => {
    const result = layoutGraph(branchMerge);
    const byHash = Object.fromEntries(result.commits.map((c) => [c.hash, c]));
    expect(byHash["D"].color).toBe(PALETTE[0]);
    expect(byHash["C"].color).toBe(PALETTE[0]);
    expect(byHash["B"].color).toBe(PALETTE[1]);
    expect(byHash["A"].color).toBe(PALETTE[0]);
  });

  // ── Fixture C tests ───────────────────────────────────────────────────────

  it("Fixture C: lane recycling — laneCount is 2 (max width during layout)", () => {
    const result = layoutGraph(laneRecycling);
    expect(result.laneCount).toBe(2);
  });

  it("Fixture C: lane recycling — commit positions are topologically correct", () => {
    const result = layoutGraph(laneRecycling);
    const byHash = Object.fromEntries(result.commits.map((c) => [c.hash, c]));
    // F is newest → row 0; A is oldest → row 5
    expect(byHash["F"].row).toBe(0);
    expect(byHash["E"].row).toBe(1);
    expect(byHash["D"].row).toBe(2);
    expect(byHash["C"].row).toBe(3);
    expect(byHash["B"].row).toBe(4);
    expect(byHash["A"].row).toBe(5);
  });

  it("Fixture C: lane recycling — F, E, D, C, A on lane 0; B on lane 1", () => {
    const result = layoutGraph(laneRecycling);
    const byHash = Object.fromEntries(result.commits.map((c) => [c.hash, c]));
    expect(byHash["F"].lane).toBe(0);
    expect(byHash["E"].lane).toBe(0);
    expect(byHash["D"].lane).toBe(0);
    expect(byHash["C"].lane).toBe(0);
    expect(byHash["B"].lane).toBe(1);
    expect(byHash["A"].lane).toBe(0);
  });

  // ── Fixture D tests ───────────────────────────────────────────────────────

  it("Fixture D: octopus merge — laneCount === 3", () => {
    const result = layoutGraph(octopus);
    expect(result.laneCount).toBe(3);
  });

  it("Fixture D: octopus merge — X is on lane 0", () => {
    const result = layoutGraph(octopus);
    const x = result.commits.find((c) => c.hash === "X")!;
    expect(x.lane).toBe(0);
  });

  it("Fixture D: octopus merge — 3 edges (X→A, X→B, X→C)", () => {
    const result = layoutGraph(octopus);
    expect(result.edges).toHaveLength(3);
  });

  it("Fixture D: octopus merge — all edges have X's color", () => {
    const result = layoutGraph(octopus);
    const x = result.commits.find((c) => c.hash === "X")!;
    for (const e of result.edges) {
      expect(e.fromRow).toBe(x.row);
      expect(e.color).toBe(x.color);
    }
  });

  // ── Fixture E: Empty input ────────────────────────────────────────────────

  it("Fixture E: empty input → empty layout", () => {
    const result = layoutGraph([]);
    expect(result.commits).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.laneCount).toBe(0);
  });

  // ── Fixture F: Parent outside window ─────────────────────────────────────

  it("Fixture F: parent outside window — commit laid out normally", () => {
    const result = layoutGraph(parentOutsideWindow);
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].hash).toBe("B");
    expect(result.commits[0].lane).toBe(0);
  });

  it("Fixture F: parent outside window — edge to missing parent is omitted", () => {
    const result = layoutGraph(parentOutsideWindow);
    // No edge because "A" is not in positions map.
    expect(result.edges).toHaveLength(0);
  });
});
