/**
 * Tests for GitGraphSvg — P3-T4
 *
 * Strategy:
 * - Hand-craft a GraphLayout fixture (via layoutGraph) for a 3-commit linear chain.
 * - Verify SVG rendering: circles, paths, click callbacks, hover tooltips,
 *   and selection halo.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { I18nProvider } from "@/lib/i18n";
import { layoutGraph } from "@/lib/git-graph-layout";
import { GitGraphSvg } from "@/components/task/git-graph-svg";

// ---------------------------------------------------------------------------
// Fixture — 3-commit linear chain (newest → oldest)
// ---------------------------------------------------------------------------
const FIXTURE = layoutGraph([
  {
    hash: "c",
    shortHash: "c",
    parents: ["b"],
    author: "Alice",
    date: new Date().toISOString(),
    subject: "third",
    refs: ["main"],
  },
  {
    hash: "b",
    shortHash: "b",
    parents: ["a"],
    author: "Alice",
    date: new Date(Date.now() - 86400000).toISOString(),
    subject: "second",
    refs: [],
  },
  {
    hash: "a",
    shortHash: "a",
    parents: [],
    author: "Bob",
    date: new Date(Date.now() - 172800000).toISOString(),
    subject: "first",
    refs: [],
  },
]);

function renderGraph(
  props?: Partial<{
    selectedCommitHash: string | null;
    onCommitClick: (hash: string) => void;
  }>
) {
  return render(
    <I18nProvider>
      <GitGraphSvg
        layout={FIXTURE}
        selectedCommitHash={props?.selectedCommitHash}
        onCommitClick={props?.onCommitClick}
      />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("GitGraphSvg", () => {
  it("renders correct number of circles — at least 3 (one per commit)", () => {
    renderGraph();
    const circles = document.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThanOrEqual(3);
  });

  it("renders at least 2 path edges", () => {
    renderGraph();
    const paths = document.querySelectorAll("path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it("click commit fires onCommitClick callback with correct hash", () => {
    const onCommitClick = vi.fn();
    renderGraph({ onCommitClick });

    // Find the commit group for hash "b" and click its invisible click target
    const commitGroup = document.querySelector('[data-hash="b"]');
    expect(commitGroup).not.toBeNull();
    fireEvent.click(commitGroup!);

    expect(onCommitClick).toHaveBeenCalledWith("b");
  });

  // Hover tooltip test removed — tooltip was extracted in favor of inline
  // metadata in the commit list row (subject + refs + hash + author + age).
  // See git-history-panel.tsx for the new rendering.

  it("selection halo renders — two circles at same cx/cy for selected commit", () => {
    renderGraph({ selectedCommitHash: "b" });

    // Find the commit group for hash "b"
    const commitGroup = document.querySelector('[data-hash="b"]');
    expect(commitGroup).not.toBeNull();

    // Should have at least 2 circles: halo + main dot
    const circles = commitGroup!.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThanOrEqual(2);

    // Both should share the same cx and cy
    const cxValues = Array.from(circles).map((c) => c.getAttribute("cx"));
    const cyValues = Array.from(circles).map((c) => c.getAttribute("cy"));
    expect(cxValues[0]).toBe(cxValues[1]);
    expect(cyValues[0]).toBe(cyValues[1]);
  });
});
