/**
 * git-graph-layout.ts
 *
 * Pure function library for computing lane positions and edges for a git
 * history graph.  No React, no I/O, no side effects.
 *
 * Algorithm: Smith-waterfall / Bonsai-style lane assignment.
 *
 * State: lanes[i] = the parent-hash this lane is "waiting" to render next,
 * or null if the lane is free.
 *
 * For each commit (newest-first):
 *   1. Find the lane waiting for this commit (or take the first free lane).
 *   2. Point that lane at commit.parents[0] (the main-line parent).
 *   3. For each additional parent (merge), allocate/reuse another lane.
 *   4. (Pass 2) Build edges using a positions map.
 */

export interface RawCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  /** Commit message body (everything after the subject line). May be empty. */
  body?: string;
  refs: string[];
}

export interface LaidOutCommit extends RawCommit {
  lane: number;
  row: number;
  color: string;
}

export interface Edge {
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
  color: string;
}

export interface GraphLayout {
  commits: LaidOutCommit[];
  edges: Edge[];
  laneCount: number;
}

const PALETTE = [
  "#3fb950", "#58a6ff", "#f78166", "#d2a8ff",
  "#ffa657", "#7ee787", "#79c0ff", "#ff7b72",
];

const colorFor = (lane: number): string => PALETTE[lane % PALETTE.length];

export function layoutGraph(commits: RawCommit[]): GraphLayout {
  // lanes[i] = the hash this lane is waiting to render, or null if free.
  const lanes: (string | null)[] = [];

  // Map from commit hash → its final position (set during pass 1).
  const positions = new Map<string, { lane: number; row: number; color: string }>();

  const laidOut: LaidOutCommit[] = [];

  /**
   * Returns the index of the first lane satisfying the predicate.
   * If none exists, pushes a new null lane and returns its index.
   */
  function takeLane(predicate: (slot: string | null) => boolean): number {
    for (let i = 0; i < lanes.length; i++) {
      if (predicate(lanes[i])) return i;
    }
    lanes.push(null);
    return lanes.length - 1;
  }

  // Pass 1: assign lanes.
  commits.forEach((commit, row) => {
    // Find a lane already waiting for this commit's hash.
    let lane = lanes.findIndex((slot) => slot === commit.hash);
    if (lane === -1) {
      // Nobody was waiting — grab the first free (null) lane.
      lane = takeLane((slot) => slot === null);
    }

    // This lane now waits for the primary parent (undefined → null for roots).
    lanes[lane] = commit.parents[0] ?? null;

    // For each additional parent (merge commit), allocate or reuse a lane.
    for (let i = 1; i < commit.parents.length; i++) {
      const parentHash = commit.parents[i];
      // Reuse a lane if it is already waiting for this exact parent.
      let parentLane = lanes.findIndex((slot) => slot === parentHash);
      if (parentLane === -1) {
        parentLane = takeLane((slot) => slot === null);
        lanes[parentLane] = parentHash;
      }
    }

    const color = colorFor(lane);
    positions.set(commit.hash, { lane, row, color });
    laidOut.push({ ...commit, lane, row, color });
  });

  // Pass 2: build edges.
  const edges: Edge[] = [];
  for (const commit of laidOut) {
    for (const parentHash of commit.parents) {
      const parent = positions.get(parentHash);
      if (!parent) continue; // parent is outside the windowed log range
      edges.push({
        fromLane: commit.lane,
        fromRow:  commit.row,
        toLane:   parent.lane,
        toRow:    parent.row,
        color:    commit.color, // edge inherits the child commit's color
      });
    }
  }

  return {
    commits:   laidOut,
    edges,
    laneCount: lanes.length,
  };
}
