"use client";

import { useState } from "react";
import type { GraphLayout } from "@/lib/git-graph-layout";
import { formatBlameAge } from "@/components/task/blame-overlay";
import { useI18n } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LANE_WIDTH = 16;   // px between lanes
const ROW_HEIGHT = 44;   // px between rows — also the per-commit list-row height in git-history-panel.tsx (must match)
const DOT_RADIUS = 5;
const SVG_PADDING = 8;
const TOOLTIP_WIDTH = 240;
const TOOLTIP_HEIGHT = 180;
const TOOLTIP_OFFSET = 20;
// Internal constants only; ROW_HEIGHT/LANE_WIDTH/DOT_RADIUS/SVG_PADDING are
// re-declared here AND in git-history-panel.tsx — keep them in sync.

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface GitGraphSvgProps {
  layout: GraphLayout;
  selectedCommitHash?: string | null;
  onCommitClick?: (hash: string) => void;
}

// ---------------------------------------------------------------------------
// Helper: compute (cx, cy) for a commit at lane L, row R
// ---------------------------------------------------------------------------
function cx(lane: number): number {
  return SVG_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function cy(row: number): number {
  return SVG_PADDING + row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

// ---------------------------------------------------------------------------
// GitGraphSvg component
// ---------------------------------------------------------------------------
export function GitGraphSvg({
  layout,
  selectedCommitHash,
  onCommitClick,
}: GitGraphSvgProps) {
  const { t } = useI18n();
  const [hoveredCommit, setHoveredCommit] = useState<string | null>(null);

  const svgWidth = layout.laneCount * LANE_WIDTH + SVG_PADDING * 2;
  const svgHeight = layout.commits.length * ROW_HEIGHT + SVG_PADDING * 2;

  // ---------------------------------------------------------------------------
  // Hover tooltip positioning
  // ---------------------------------------------------------------------------
  const hoveredPos = hoveredCommit
    ? layout.commits.find((c) => c.hash === hoveredCommit)
    : null;

  // Tooltip positioning — offset OFF the dot (so cursor doesn't cover the popup
  // text) and auto-flip horizontally + vertically when it would overflow the
  // SVG bounds. Default placement: to the right of and below the dot.
  const dotX = hoveredPos ? hoveredPos.lane * LANE_WIDTH + SVG_PADDING + LANE_WIDTH / 2 : 0;
  const dotY = hoveredPos ? hoveredPos.row * ROW_HEIGHT + SVG_PADDING + ROW_HEIGHT / 2 : 0;

  const wantRight = dotX + TOOLTIP_OFFSET + TOOLTIP_WIDTH <= svgWidth;
  const tipX = hoveredPos
    ? wantRight
      ? dotX + TOOLTIP_OFFSET
      : Math.max(0, dotX - TOOLTIP_OFFSET - TOOLTIP_WIDTH)
    : 0;

  const wantBelow = dotY + TOOLTIP_OFFSET + TOOLTIP_HEIGHT <= svgHeight;
  const tipY = hoveredPos
    ? wantBelow
      ? dotY + TOOLTIP_OFFSET
      : Math.max(0, dotY - TOOLTIP_OFFSET - TOOLTIP_HEIGHT)
    : 0;

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
        const y1 = cy(edge.fromRow);
        const x2 = cx(edge.toLane);
        const y2 = cy(edge.toRow);

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
        const commitCy = cy(commit.row);
        const isSelected = commit.hash === selectedCommitHash;

        return (
          <g
            key={commit.hash}
            data-hash={commit.hash}
            onMouseEnter={() => setHoveredCommit(commit.hash)}
            onMouseLeave={() => setHoveredCommit(null)}
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

      {/* ------------------------------------------------------------------ */}
      {/* Hover tooltip                                                       */}
      {/* ------------------------------------------------------------------ */}
      {hoveredPos && (
        <foreignObject
          x={tipX}
          y={tipY}
          width={TOOLTIP_WIDTH}
          height={TOOLTIP_HEIGHT}
          style={{ pointerEvents: "none" }}
        >
          <div className="bg-popover border border-border rounded-md shadow-lg p-2 text-xs space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{hoveredPos.author}</span>
              <span className="font-mono text-muted-foreground">
                {hoveredPos.shortHash}
              </span>
            </div>
            <div className="text-muted-foreground">
              {formatBlameAge(hoveredPos.date)}
            </div>
            <div className="text-foreground break-words">{hoveredPos.subject}</div>
            {hoveredPos.refs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {hoveredPos.refs.map((r) => (
                  <span
                    key={r}
                    className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono"
                  >
                    {r}
                  </span>
                ))}
              </div>
            )}
            {hoveredPos.parents.length > 0 && (
              <div className="font-mono text-[10px] text-muted-foreground">
                {t("git.hoverParentsLabel")}:{" "}
                {hoveredPos.parents.map((p) => p.slice(0, 7)).join(", ")}
              </div>
            )}
          </div>
        </foreignObject>
      )}
    </svg>
  );
}
