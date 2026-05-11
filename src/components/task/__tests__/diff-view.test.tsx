/**
 * Tests for DiffView component.
 *
 * Strategy: focus on WRAPPER behavior (Stage/Discard buttons and their callbacks).
 * We mock @git-diff-view/react so it renders a simple <pre> with the hunk
 * content — avoids coupling tests to the library's internal DOM.
 *
 * Test 1: renders both hunks (their header lines appear in the output).
 * Test 2: Stage button calls onStageHunk with the hunk patch.
 * Test 3: No Stage button when onStageHunk is not provided.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { I18nProvider } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Mock @git-diff-view/react
// The library component (DiffView) is a "use client" SSR-capable component.
// We replace it with a simple stub that renders its hunks prop as text so
// tests can verify content without depending on library internals.
// ---------------------------------------------------------------------------
vi.mock("@git-diff-view/react", () => {
  const GitDiffViewMock = ({
    data,
  }: {
    data?: { hunks?: string[]; oldFile?: unknown; newFile?: unknown };
  }) => {
    const hunks = data?.hunks ?? [];
    return (
      <div data-testid="git-diff-view">
        {hunks.map((h, i) => (
          <pre key={i}>{h}</pre>
        ))}
      </div>
    );
  };
  return {
    DiffView: GitDiffViewMock,
    DiffModeEnum: { Split: 3, Unified: 4, SplitGitHub: 1, SplitGitLab: 2 },
  };
});

// Import after mock is set up
import { DiffView } from "@/components/task/diff-view";

// ---------------------------------------------------------------------------
// Fixture: two-hunk unified diff for a single file
// ---------------------------------------------------------------------------
const FIXTURE = [
  "diff --git a/x.ts b/x.ts",
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ -1,3 +1,3 @@",
  "-a",
  "+b",
  " c",
  " d",
  "@@ -10,2 +10,3 @@",
  " e",
  "+f",
  " g",
  "",
].join("\n");

function renderDiffView(props: {
  patch: string;
  language?: string;
  onStageHunk?: (patch: string) => void;
  onDiscardHunk?: (patch: string) => void;
}) {
  return render(
    <I18nProvider>
      <DiffView {...props} />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("DiffView", () => {
  it("renders both hunks from the patch", () => {
    const { container } = renderDiffView({ patch: FIXTURE });

    // Both hunk headers should appear in the rendered output
    const text = container.textContent ?? "";
    expect(text).toContain("@@ -1,3 +1,3 @@");
    expect(text).toContain("@@ -10,2 +10,3 @@");
  });

  it("calls onStageHunk with the matching hunk's patch (verifies per-chunk routing)", () => {
    // Typed at declaration so spy.mock.calls is inferred as [string][]
    const spy = vi.fn<(hunkPatch: string) => void>();
    renderDiffView({ patch: FIXTURE, onStageHunk: spy });

    // I18nProvider defaults to "zh" — buttons render as "暂存此 hunk".
    // Match by partial text that covers both zh and en labels.
    const stageButtons = screen.getAllByRole("button", { name: /hunk/i });
    expect(stageButtons.length).toBe(2);

    // First button → first hunk
    fireEvent.click(stageButtons[0]);
    expect(spy).toHaveBeenCalledOnce();
    const firstArg = spy.mock.calls[0][0];
    expect(typeof firstArg).toBe("string");
    expect(firstArg).toContain("@@ -1,3 +1,3 @@");
    expect(firstArg).toContain("+b");

    // Second button → second hunk (verifies per-chunk routing, not chunk[0] fallback)
    fireEvent.click(stageButtons[1]);
    expect(spy).toHaveBeenCalledTimes(2);
    const secondArg = spy.mock.calls[1][0];
    expect(secondArg).toContain("@@ -10,2 +10,3 @@");
    expect(secondArg).toContain("+f");
    // Sanity: the second arg must NOT contain the first hunk's header
    expect(secondArg).not.toContain("@@ -1,3 +1,3 @@");
  });

  it("does not render Stage button when onStageHunk is not provided", () => {
    renderDiffView({ patch: FIXTURE });

    // No stage buttons should be in the DOM (no callback → no toolbar)
    const buttons = screen.queryAllByRole("button");
    expect(buttons.length).toBe(0);
  });
});
