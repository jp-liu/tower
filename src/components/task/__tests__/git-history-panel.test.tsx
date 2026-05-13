/**
 * Tests for GitHistoryPanel — P4-T5
 *
 * Strategy:
 * - Mock gitAction from @/lib/git-api
 * - Stub GitGraphSvg to avoid SVG/foreignObject jsdom quirks
 * - Test: initial load, commit selection, file click callback, empty repo
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mock @/lib/git-api
// ---------------------------------------------------------------------------
vi.mock("@/lib/git-api", () => ({
  gitAction: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stub GitGraphSvg — renders a button per commit so tests can click
// ---------------------------------------------------------------------------
vi.mock("@/components/task/git-graph-svg", () => ({
  GitGraphSvg: ({
    layout,
    onCommitClick,
  }: {
    layout: { commits: { hash: string }[] };
    selectedCommitHash?: string | null;
    onCommitClick?: (hash: string) => void;
  }) => (
    <div data-testid="git-graph-svg-stub">
      {layout.commits.map((c) => (
        <button
          key={c.hash}
          data-testid={`svg-commit-${c.hash}`}
          onClick={() => onCommitClick?.(c.hash)}
        >
          {c.hash}
        </button>
      ))}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock ScrollArea to render children directly
// ---------------------------------------------------------------------------
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Stub CommitActionMenu — renders a testid div when open
// ---------------------------------------------------------------------------
vi.mock("@/components/task/commit-action-menu", () => ({
  CommitActionMenu: ({ open, commit }: { open: boolean; commit: { hash: string } }) =>
    open ? <div data-testid="commit-action-menu-stub">{commit.hash}</div> : null,
}));

import { GitHistoryPanel } from "@/components/task/git-history-panel";
import { I18nProvider } from "@/lib/i18n";
import { gitAction } from "@/lib/git-api";

const mockGitAction = gitAction as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const FAKE_COMMITS = [
  {
    hash: "aaaaaaaaaaaaaaaaaaaaaa",
    shortHash: "aaaaaaa",
    parents: [],
    author: "Alice",
    date: new Date(Date.now() - 86400000).toISOString(),
    subject: "first commit",
    refs: ["main"],
  },
  {
    hash: "bbbbbbbbbbbbbbbbbbbbbb",
    shortHash: "bbbbbbb",
    parents: ["aaaaaaaaaaaaaaaaaaaaaa"],
    author: "Bob",
    date: new Date(Date.now() - 3600000).toISOString(),
    subject: "second commit",
    refs: [],
  },
  {
    hash: "cccccccccccccccccccccc",
    shortHash: "ccccccc",
    parents: ["bbbbbbbbbbbbbbbbbbbbbb"],
    author: "Carol",
    date: new Date().toISOString(),
    subject: "third commit",
    refs: [],
  },
];

const FAKE_FILES = [
  { filename: "src/foo.ts", added: 12, removed: 3, isBinary: false, patch: "" },
  { filename: "src/bar.ts", added: 5, removed: 0, isBinary: false, patch: "" },
];

const FAKE_PATCH = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,15 @@
+added line 1
+added line 2
 unchanged
diff --git a/src/bar.ts b/src/bar.ts
index 111..222 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1 +1,6 @@
+new content
`;

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
function renderPanel(
  props?: Partial<React.ComponentProps<typeof GitHistoryPanel>>
) {
  const defaults = { worktreePath: "/repo" };
  return render(
    <I18nProvider>
      <GitHistoryPanel {...defaults} {...props} />
    </I18nProvider>
  );
}

describe("GitHistoryPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // -------------------------------------------------------------------------
  // Test 1: Initial load — all 3 commit subjects visible
  // -------------------------------------------------------------------------
  it("shows all commit subjects after initial load", async () => {
    mockGitAction.mockResolvedValue({
      commits: FAKE_COMMITS,
      head: FAKE_COMMITS[2].hash,
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("first commit")).toBeInTheDocument();
    });

    expect(screen.getByText("second commit")).toBeInTheDocument();
    expect(screen.getByText("third commit")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Test 2: Click commit reveals files panel
  // -------------------------------------------------------------------------
  it("clicking a commit row fetches and shows files", async () => {
    mockGitAction
      .mockResolvedValueOnce({ commits: FAKE_COMMITS, head: null })
      .mockResolvedValueOnce({ patch: FAKE_PATCH, files: FAKE_FILES });

    renderPanel();

    // Wait for commits to load
    await waitFor(() => {
      expect(screen.getByText("second commit")).toBeInTheDocument();
    });

    // Click the second commit row (data-hash in commit list)
    const commitRows = screen.getAllByTestId("commit-row");
    fireEvent.click(commitRows[1]);

    // Wait for files to appear
    await waitFor(() => {
      expect(screen.getByText("src/foo.ts")).toBeInTheDocument();
    });

    expect(screen.getByText("src/bar.ts")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Test 3: Click file fires onSelectCommitFile with content fetched via
  // commit-file-content action (Monaco DiffEditor refactor, v1.3.1)
  // -------------------------------------------------------------------------
  it("clicking a file row fires onSelectCommitFile with hash, filename, and before/after content", async () => {
    const onSelectCommitFile = vi.fn();

    mockGitAction
      .mockResolvedValueOnce({ commits: FAKE_COMMITS, head: null })
      .mockResolvedValueOnce({ patch: FAKE_PATCH, files: FAKE_FILES })
      .mockResolvedValueOnce({ before: "old foo\n", after: "new foo\n" });

    renderPanel({ onSelectCommitFile });

    // Wait for commits
    await waitFor(() => {
      expect(screen.getByText("second commit")).toBeInTheDocument();
    });

    // Click commit row to select it
    const commitRows = screen.getAllByTestId("commit-row");
    fireEvent.click(commitRows[1]); // "bbbbbbbbbbbbbbbbbbbbbb"

    // Wait for files panel
    await waitFor(() => {
      expect(screen.getByText("src/foo.ts")).toBeInTheDocument();
    });

    // Click the first file — fires async commit-file-content fetch
    const fileRows = screen.getAllByTestId("commit-file-row");
    fireEvent.click(fileRows[0]);

    await waitFor(() => {
      expect(onSelectCommitFile).toHaveBeenCalledTimes(1);
    });
    const args = onSelectCommitFile.mock.calls[0][0];
    expect(args.commitHash).toBe("bbbbbbbbbbbbbbbbbbbbbb");
    expect(args.relativePath).toBe("src/foo.ts");
    expect(args.originalContent).toBe("old foo\n");
    expect(args.modifiedContent).toBe("new foo\n");
  });

  // -------------------------------------------------------------------------
  // Test 4: Empty repo — shows "No commits" message
  // -------------------------------------------------------------------------
  it("shows empty state message when no commits returned", async () => {
    mockGitAction.mockResolvedValue({ commits: [], head: null });

    renderPanel();

    // I18nProvider defaults to zh; "git.noCommits" → "暂无提交"
    await waitFor(() => {
      expect(screen.getByText("暂无提交")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: ⋯ button click opens CommitActionMenu
  // -------------------------------------------------------------------------
  it("clicking the ⋯ button on a commit row opens CommitActionMenu", async () => {
    mockGitAction.mockResolvedValue({
      commits: FAKE_COMMITS,
      head: FAKE_COMMITS[2].hash,
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("first commit")).toBeInTheDocument();
    });

    // Menu should not be visible initially
    expect(screen.queryByTestId("commit-action-menu-stub")).not.toBeInTheDocument();

    // Click the ⋯ button on the first commit row
    const moreButtons = screen.getAllByTestId("commit-more-button");
    fireEvent.click(moreButtons[0]);

    // Menu should now be visible showing the commit hash
    await waitFor(() => {
      expect(screen.getByTestId("commit-action-menu-stub")).toBeInTheDocument();
    });
    expect(screen.getByTestId("commit-action-menu-stub")).toHaveTextContent(
      FAKE_COMMITS[0].hash
    );
  });

  // -------------------------------------------------------------------------
  // Test 6: Right-click on commit row opens CommitActionMenu
  // -------------------------------------------------------------------------
  it("right-clicking a commit row opens CommitActionMenu for that commit", async () => {
    mockGitAction.mockResolvedValue({
      commits: FAKE_COMMITS,
      head: FAKE_COMMITS[2].hash,
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("second commit")).toBeInTheDocument();
    });

    // Menu should not be visible initially
    expect(screen.queryByTestId("commit-action-menu-stub")).not.toBeInTheDocument();

    // Right-click on the second commit row
    const commitRows = screen.getAllByTestId("commit-row");
    fireEvent.contextMenu(commitRows[1]);

    // Menu should now be visible showing the second commit's hash
    await waitFor(() => {
      expect(screen.getByTestId("commit-action-menu-stub")).toBeInTheDocument();
    });
    expect(screen.getByTestId("commit-action-menu-stub")).toHaveTextContent(
      FAKE_COMMITS[1].hash
    );
  });
});
