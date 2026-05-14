import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, act, screen } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mock @/lib/git-api
// ---------------------------------------------------------------------------
vi.mock("@/lib/git-api", () => ({
  gitAction: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock sonner (toast)
// ---------------------------------------------------------------------------
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { BlameList } from "@/components/task/blame-overlay";
import { I18nProvider } from "@/lib/i18n";
import { gitAction } from "@/lib/git-api";

const mockGitAction = gitAction as ReturnType<typeof vi.fn>;

const SAMPLE_LINES = [
  {
    line: 1,
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    author: "Alice",
    summary: "Initial commit",
    date: "2023-11-14T00:00:00.000Z",
  },
  {
    line: 2,
    sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    author: "Bob",
    summary: "Second commit",
    date: "2023-11-15T00:00:00.000Z",
  },
];

function renderBlameList(props?: Partial<{ worktreePath: string; relativePath: string }>) {
  return render(
    <I18nProvider>
      <BlameList
        worktreePath={props?.worktreePath ?? "/repo"}
        relativePath={props?.relativePath ?? "src/file.ts"}
      />
    </I18nProvider>
  );
}

describe("BlameList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders blame lines with sha, author, and line numbers", async () => {
    mockGitAction.mockResolvedValue({ lines: SAMPLE_LINES });

    await act(async () => {
      renderBlameList();
    });

    await waitFor(() => {
      expect(screen.getByTestId("blame-list")).toBeInTheDocument();
    });

    // Check author names are visible
    const authorEls = screen.getAllByTestId("blame-author");
    expect(authorEls.some((el) => el.textContent === "Alice")).toBe(true);
    expect(authorEls.some((el) => el.textContent === "Bob")).toBe(true);

    // Check shortened shas are visible
    const shaEls = screen.getAllByTestId("blame-sha");
    expect(shaEls.some((el) => el.textContent === "aaaaaaa")).toBe(true);
    expect(shaEls.some((el) => el.textContent === "bbbbbbb")).toBe(true);
  });

  it("shows no blame message when API returns empty lines", async () => {
    mockGitAction.mockResolvedValue({ lines: [] });

    await act(async () => {
      renderBlameList();
    });

    await waitFor(() => {
      // Should show the "no blame" empty state (i18n key: git.noBlame)
      expect(screen.queryByTestId("blame-list")).not.toBeInTheDocument();
    });
  });

  it("calls gitAction with blame action and correct file path", async () => {
    mockGitAction.mockResolvedValue({ lines: SAMPLE_LINES });

    await act(async () => {
      renderBlameList({ worktreePath: "/my/repo", relativePath: "lib/utils.ts" });
    });

    await waitFor(() => {
      expect(mockGitAction).toHaveBeenCalledWith(
        "/my/repo",
        "blame",
        expect.objectContaining({ file: "lib/utils.ts" })
      );
    });
  });

  it("renders loading spinner initially before data arrives", async () => {
    // Never resolve to keep in loading state
    mockGitAction.mockReturnValue(new Promise(() => {}));

    await act(async () => {
      renderBlameList();
    });

    // Loader2 spinner has animate-spin class
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
  });

  it("handles API error gracefully — shows empty state", async () => {
    mockGitAction.mockRejectedValue(new Error("network error"));

    await act(async () => {
      renderBlameList();
    });

    await waitFor(() => {
      expect(screen.queryByTestId("blame-list")).not.toBeInTheDocument();
    });
  });
});
