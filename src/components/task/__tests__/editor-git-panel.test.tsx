/**
 * Tests for EditorGitPanel — hunk dialog (Task 9).
 *
 * Strategy:
 * - Mock fetch for the initial git status GET
 * - Mock gitAction from @/lib/git-api to control diff-file / stage-hunk responses
 * - Mock DiffView from @/components/task/diff-view to a stub that exposes
 *   onStageHunk / onDiscardHunk props as test-visible buttons
 * - Verify: hunk icon renders on hover, dialog opens, stage/discard work,
 *   staged-file dialog shows only discard
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import React from "react";
import { I18nProvider } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Two-hunk patch fixture
// ---------------------------------------------------------------------------
const TWO_HUNK_PATCH = [
  "diff --git a/src/x.ts b/src/x.ts",
  "--- a/src/x.ts",
  "+++ b/src/x.ts",
  "@@ -1,3 +1,3 @@",
  "-old",
  "+new",
  " ctx",
  "@@ -10,2 +10,3 @@",
  " e",
  "+f",
  " g",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// Mock @/lib/git-api
// ---------------------------------------------------------------------------
const mockGitAction = vi.fn();
vi.mock("@/lib/git-api", () => ({
  gitAction: (...args: unknown[]) => mockGitAction(...args),
}));

// ---------------------------------------------------------------------------
// Mock @/components/task/diff-view
// Splits the patch into hunks by `@@` markers and renders one stage / discard
// button pair PER hunk so tests can verify per-hunk routing (i.e. clicking
// the Nth hunk's button passes a hunk-specific patch string, not chunk 0).
// ---------------------------------------------------------------------------
vi.mock("@/components/task/diff-view", () => ({
  DiffView: ({
    patch,
    onStageHunk,
    onDiscardHunk,
  }: {
    patch: string;
    onStageHunk?: (p: string) => void;
    onDiscardHunk?: (p: string) => void;
  }) => {
    // Split on lines that start with @@, keeping the @@ in each split piece.
    const hunks = patch
      .split(/^(?=@@)/m)
      .filter((p) => p.startsWith("@@"));
    return (
      <div data-testid="diff-view" data-patch={patch}>
        {hunks.map((_, i) => (
          <div key={i} data-testid={`hunk-${i}`}>
            {onStageHunk && (
              <button onClick={() => onStageHunk(`hunk${i}patch`)}>Stage hunk</button>
            )}
            {onDiscardHunk && (
              <button onClick={() => onDiscardHunk(`hunk${i}patch`)}>Discard hunk</button>
            )}
          </div>
        ))}
      </div>
    );
  },
}));

// ---------------------------------------------------------------------------
// Mock @/components/repository/create-branch-dialog
// ---------------------------------------------------------------------------
vi.mock("@/components/repository/create-branch-dialog", () => ({
  CreateBranchDialog: () => null,
}));

// ---------------------------------------------------------------------------
// Mock sonner toast
// ---------------------------------------------------------------------------
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

// ---------------------------------------------------------------------------
// Mock @/components/ui/scroll-area (avoids ResizeObserver issues in jsdom)
// ---------------------------------------------------------------------------
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="scroll-area">{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Helper: build the mock fetch response for /api/git?path=...
// ---------------------------------------------------------------------------
function makeGitInfoResponse(extraFiles: Array<{ file: string; status: string; staged: boolean }> = []) {
  return new Response(
    JSON.stringify({
      isGit: true,
      currentBranch: "main",
      branches: ["main"],
      remoteBranches: [],
      changedFiles: [
        { file: "src/x.ts", status: "modified", staged: false },
        ...extraFiles,
      ],
      ahead: 0,
      behind: 0,
      remoteUrl: "",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// Import component AFTER mocks are set up
import { EditorGitPanel } from "@/components/task/editor-git-panel";

function renderPanel(localPath = "/x") {
  return render(
    <I18nProvider>
      <EditorGitPanel localPath={localPath} />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  // Default fetch mock: returns one unstaged modified file.
  // The component uses a relative URL (/api/git?path=...) so we match
  // on the string containing "api/git" regardless of origin.
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const urlStr = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;
    if (urlStr.includes("api/git")) {
      return makeGitInfoResponse();
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  // Default gitAction mock
  mockGitAction.mockResolvedValue({ patch: TWO_HUNK_PATCH });
});

describe("EditorGitPanel — hunk dialog", () => {
  it("renders the hunk-icon button on unstaged file row and calls gitAction diff-file on click", async () => {
    renderPanel();

    // Wait for the panel to load the git status.
    // The tree builder renders only the filename part (x.ts), not the full path.
    await waitFor(() => {
      // "x.ts" should appear in the rendered file row
      expect(screen.getByText("x.ts")).toBeInTheDocument();
    });

    // Click the view-hunks button — it should call gitAction with diff-file
    const viewHunksBtn = screen.getByLabelText(/查看|view.*hunk/i);
    await act(async () => {
      fireEvent.click(viewHunksBtn);
    });

    await waitFor(() => {
      expect(mockGitAction).toHaveBeenCalledWith(
        "/x",
        "diff-file",
        { file: "src/x.ts", staged: false }
      );
    });
  });

  it("opens the dialog with Stage and Discard buttons for an unstaged file", async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("x.ts")).toBeInTheDocument();
    });

    // Click the view-hunks icon
    const viewHunksBtn = screen.getByLabelText(/查看|view.*hunk/i);
    await act(async () => {
      fireEvent.click(viewHunksBtn);
    });

    // Dialog opens with DiffView stub that shows Stage + Discard.
    // The two-hunk fixture produces 2 Stage buttons and 2 Discard buttons.
    await waitFor(() => {
      expect(screen.getByTestId("diff-view")).toBeInTheDocument();
    });

    expect(screen.getAllByRole("button", { name: "Stage hunk" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Discard hunk" })).toHaveLength(2);
  });

  it("routes stage-hunk to the correct chunk (verifies per-hunk identity, not chunk-0 fallback)", async () => {
    mockGitAction
      .mockResolvedValueOnce({ patch: TWO_HUNK_PATCH }) // diff-file call
      .mockResolvedValueOnce({});                         // stage-hunk call

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("x.ts")).toBeInTheDocument();
    });

    const viewHunksBtn = screen.getByLabelText(/查看|view.*hunk/i);
    await act(async () => {
      fireEvent.click(viewHunksBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("diff-view")).toBeInTheDocument();
    });

    // Click the SECOND Stage button (hunk index 1) to verify per-hunk routing
    // — the test would pass even if production sent chunk 0 only if we clicked
    // index 0, so we deliberately use index 1.
    const stageBtns = screen.getAllByRole("button", { name: "Stage hunk" });
    expect(stageBtns).toHaveLength(2);
    await act(async () => {
      fireEvent.click(stageBtns[1]);
    });

    await waitFor(() => {
      expect(mockGitAction).toHaveBeenCalledWith("/x", "stage-hunk", { patch: "hunk1patch" });
    });

    // Dialog should close after applying hunk
    await waitFor(() => {
      expect(screen.queryByTestId("diff-view")).not.toBeInTheDocument();
    });
  });

  it("shows only Discard (no Stage) for a staged file", async () => {
    // Override fetch to return a staged file
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
      if (urlStr.includes("api/git")) {
        return new Response(
          JSON.stringify({
            isGit: true,
            currentBranch: "main",
            branches: ["main"],
            remoteBranches: [],
            changedFiles: [
              { file: "src/y.ts", status: "modified", staged: true },
            ],
            ahead: 0,
            behind: 0,
            remoteUrl: "",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    renderPanel();

    // Wait for staged file to appear (only the filename part)
    await waitFor(() => {
      expect(screen.getByText("y.ts")).toBeInTheDocument();
    });

    // Staged section has a hunk button too
    const viewHunksBtn = screen.getByLabelText(/查看|view.*hunk/i);
    await act(async () => {
      fireEvent.click(viewHunksBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("diff-view")).toBeInTheDocument();
    });

    // For staged files: only Discard, no Stage button.
    // Two-hunk fixture yields 2 Discard buttons and 0 Stage buttons.
    expect(screen.queryAllByRole("button", { name: "Stage hunk" })).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Discard hunk" })).toHaveLength(2);

    // Also verify gitAction was called with staged: true
    expect(mockGitAction).toHaveBeenCalledWith("/x", "diff-file", { file: "src/y.ts", staged: true });
  });
});
