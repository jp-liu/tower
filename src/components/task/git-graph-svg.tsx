"use client";

import type { GraphLayout } from "@/lib/git-graph-layout";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LANE_WIDTH = 16;   // px between lanes
const ROW_HEIGHT = 28;   // px per row — single-line layout in git-history-panel.tsx (must match)
const DOT_RADIUS = 5;
// Horizontal-only padding. There is NO top padding: the SVG is absolute-
// positioned at top:0 over a commit list whose rows also start at y=0, so a
// top offset here would push every dot below its row's vertical center.
const SVG_PADDING_X = 8;
// Internal constants only; ROW_HEIGHT/LANE_WIDTH/DOT_RADIUS are
// re-declared here AND in git-history-panel.tsx — keep them in sync.

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface GitGraphSvgProps {
  layout: GraphLayout;
  selectedCommitHash?: string | null;
  onCommitClick?: (hash: string) => void;
  /** Insert `extraRows` empty rows AFTER the commit at `afterRow` (no dot
   *  there). Used for VSCode-style inline file-list expansion under the
   *  selected commit. All commits with row index > afterRow shift down. */
  expandedAt?: { afterRow: number; extraRows: number } | null;
}

// ---------------------------------------------------------------------------
// Helper: compute (cx, cy) for a commit at lane L, row R
// ---------------------------------------------------------------------------
function cx(lane: number): number {
  return SVG_PADDING_X + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function cy(row: number): number {
  // No top padding — row 0's center must coincide with the first LI's center
  // (y = ROW_HEIGHT / 2). Adding any SVG-top offset breaks dot↔text alignment.
  return row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

// Return the effective (post-expansion) row index for a commit at `row`.
function shiftedRow(row: number, expandedAt: GitGraphSvgProps["expandedAt"]): number {
  if (!expandedAt || row <= expandedAt.afterRow) return row;
  return row + expandedAt.extraRows;
}

// ---------------------------------------------------------------------------
// GitGraphSvg component
// ---------------------------------------------------------------------------
export function GitGraphSvg({
  layout,
  selectedCommitHash,
  onCommitClick,
  expandedAt = null,
}: GitGraphSvgProps) {
  const extraRows = expandedAt?.extraRows ?? 0;
  const svgWidth = layout.laneCount * LANE_WIDTH + SVG_PADDING_X * 2;
  // Height == exact stack of rows; vertical padding would shift dots off-row.
  const svgHeight = (layout.commits.length + extraRows) * ROW_HEIGHT;

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      style={{ overflow: "visible", display: "block" }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Edges — rendered first so commit dots overlay them                  */}
      {/* ------------------------------------------------------------------ */}
      {layout.edges.map((edge, i) => {
        const x1 = cx(edge.fromLane);
        const y1 = cy(shiftedRow(edge.fromRow, expandedAt));
        const x2 = cx(edge.toLane);
        const y2 = cy(shiftedRow(edge.toRow, expandedAt));

        const d =
          edge.fromLane === edge.toLane
            ? `M ${x1} ${y1} L ${x1} ${y2}`
            : `M ${x1} ${y1} C ${x1} ${y1 + ROW_HEIGHT / 2} ${x2} ${y2 - ROW_HEIGHT / 2} ${x2} ${y2}`;

        return (
          <path
            key={i}
            d={d}
            stroke={edge.color}
            strokeWidth={1.5}
            fill="none"
          />
        );
      })}

      {/* ------------------------------------------------------------------ */}
      {/* Commits                                                             */}
      {/* ------------------------------------------------------------------ */}
      {layout.commits.map((commit) => {
        const commitCx = cx(commit.lane);
        const commitCy = cy(shiftedRow(commit.row, expandedAt));
        const isSelected = commit.hash === selectedCommitHash;

        return (
          <g
            key={commit.hash}
            data-hash={commit.hash}
            onClick={() => onCommitClick?.(commit.hash)}
            style={{ cursor: onCommitClick ? "pointer" : "default" }}
          >
            {/* Selection halo */}
            {isSelected && (
              <circle
                cx={commitCx}
                cy={commitCy}
                r={DOT_RADIUS + 3}
                fill="none"
                stroke={commit.color}
                strokeWidth={2}
                opacity={0.6}
              />
            )}

            {/* Main dot */}
            <circle
              cx={commitCx}
              cy={commitCy}
              r={DOT_RADIUS}
              fill={commit.color}
              stroke="white"
              strokeWidth={1.5}
            />

            {/* Invisible large click target */}
            <circle
              cx={commitCx}
              cy={commitCy}
              r={LANE_WIDTH / 2}
              fill="transparent"
              stroke="none"
            />
          </g>
        );
      })}

      {/* Hover tooltip removed — all commit metadata (subject, hash, author,
          age, refs) now lives inline in the commit row, and parents/full
          message appear in the inline expanded-detail header when selected.
          Hover state is kept only for the row highlight + click target. */}
    </svg>
  );
}
