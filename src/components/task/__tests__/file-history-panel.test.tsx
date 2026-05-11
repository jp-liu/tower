import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// ---------------------------------------------------------------------------
// Mock @/lib/git-api
// ---------------------------------------------------------------------------
vi.mock("@/lib/git-api", () => ({
  gitAction: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock ScrollArea to render children directly
// ---------------------------------------------------------------------------
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

import { FileHistoryPanel } from "@/components/task/file-history-panel";
import { I18nProvider } from "@/lib/i18n";
import { gitAction } from "@/lib/git-api";

const mockGitAction = gitAction as ReturnType<typeof vi.fn>;

const FAKE_COMMITS = [
  {
    hash: "abc1234567890123456789012345678901234567",
    shortHash: "abc1234",
    message: "feat: add feature\nDetails here",
    author: "Alice",
    date: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
  },
  {
    hash: "def5678901234567890123456789012345678901",
    shortHash: "def5678",
    message: "fix: patch bug",
    author: "Bob",
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
  },
];

function renderPanel(props?: Partial<React.ComponentProps<typeof FileHistoryPanel>>) {
  const defaults = {
    worktreePath: "/repo",
    relativePath: "x.ts",
    onClose: vi.fn(),
  };
  return render(
    <I18nProvider>
      <FileHistoryPanel {...defaults} {...props} />
    </I18nProvider>
  );
}

describe("FileHistoryPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows commits returned by gitAction", async () => {
    mockGitAction.mockResolvedValue({ commits: FAKE_COMMITS });

    renderPanel();

    // Should show commits after loading
    await waitFor(() => {
      expect(screen.getByText("abc1234")).toBeInTheDocument();
    });

    expect(screen.getByText("feat: add feature")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("def5678")).toBeInTheDocument();
    expect(screen.getByText("fix: patch bug")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows only first line of multi-line commit message", async () => {
    mockGitAction.mockResolvedValue({ commits: FAKE_COMMITS });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("feat: add feature")).toBeInTheDocument();
    });

    // "Details here" should NOT appear
    expect(screen.queryByText("Details here")).not.toBeInTheDocument();
  });

  it("shows empty state when no commits returned", async () => {
    mockGitAction.mockResolvedValue({ commits: [] });

    renderPanel();

    // I18nProvider defaults to zh; "git.noHistory" → "无提交记录"
    await waitFor(() => {
      expect(screen.getByText("无提交记录")).toBeInTheDocument();
    });
  });

  it("shows empty state on gitAction error", async () => {
    mockGitAction.mockRejectedValue(new Error("git failed"));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("无提交记录")).toBeInTheDocument();
    });
  });

  it("calls gitAction with correct arguments", async () => {
    mockGitAction.mockResolvedValue({ commits: [] });

    renderPanel({ worktreePath: "/my/repo", relativePath: "src/index.ts" });

    await waitFor(() => {
      expect(mockGitAction).toHaveBeenCalledWith(
        "/my/repo",
        "log-file",
        { file: "src/index.ts" }
      );
    });
  });

  it("fires onSelectCommit with correct hash when a row is clicked", async () => {
    mockGitAction.mockResolvedValue({ commits: FAKE_COMMITS });
    const onSelectCommit = vi.fn();

    renderPanel({ onSelectCommit });

    await waitFor(() => {
      expect(screen.getByText("abc1234")).toBeInTheDocument();
    });

    // Click the first commit row (title is "查看此提交" in zh locale)
    const firstRow = screen.getAllByTitle("查看此提交")[0];
    await userEvent.click(firstRow);

    expect(onSelectCommit).toHaveBeenCalledWith(FAKE_COMMITS[0].hash);
  });
});
