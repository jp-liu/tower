import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { FileTree } from "@/components/task/file-tree";
import { I18nProvider } from "@/lib/i18n";
import type { FileEntry } from "@/actions/file-actions";

// Stub mocks for server actions
const mockListDirectory = vi.fn().mockResolvedValue([]);
const mockGetGitStatus = vi.fn().mockResolvedValue({});

vi.mock("@/actions/file-actions", () => ({
  listDirectory: (...args: unknown[]) => mockListDirectory(...args),
  getGitStatus: (...args: unknown[]) => mockGetGitStatus(...args),
  createFile: vi.fn().mockResolvedValue(undefined),
  createDirectory: vi.fn().mockResolvedValue(undefined),
  renameEntry: vi.fn().mockResolvedValue(undefined),
  deleteEntry: vi.fn().mockResolvedValue(undefined),
}));

// Mock next/cache for server actions
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const defaultProps = {
  worktreePath: "/test/worktree",
  baseBranch: "main",
  worktreeBranch: "task/task-001",
  executionStatus: "COMPLETED",
  onFileSelect: vi.fn(),
};

describe("FileTree", () => {
  beforeEach(() => {
    mockListDirectory.mockResolvedValue([]);
    mockGetGitStatus.mockResolvedValue({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders empty state when worktreePath is null", () => {
    renderWithI18n(
      <FileTree
        {...defaultProps}
        worktreePath={null}
      />
    );
    expect(screen.getByText("文件树暂不可用")).toBeInTheDocument();
  });

  it("renders file nodes returned by listDirectory", async () => {
    const entries: FileEntry[] = [
      { name: "index.ts", relativePath: "index.ts", isDirectory: false },
    ];
    mockListDirectory.mockResolvedValue(entries);

    await act(async () => {
      renderWithI18n(<FileTree {...defaultProps} />);
    });

    expect(screen.getByText("index.ts")).toBeInTheDocument();
  });

  it("clicking a file node calls onFileSelect with absolute path", async () => {
    const onFileSelect = vi.fn();
    const entries: FileEntry[] = [
      { name: "index.ts", relativePath: "index.ts", isDirectory: false },
    ];
    mockListDirectory.mockResolvedValue(entries);

    await act(async () => {
      renderWithI18n(<FileTree {...defaultProps} onFileSelect={onFileSelect} />);
    });

    const fileNode = screen.getByText("index.ts");
    fireEvent.click(fileNode);

    expect(onFileSelect).toHaveBeenCalledWith("/test/worktree/index.ts");
  });

  it("starts auto-refresh interval when executionStatus is RUNNING", async () => {
    vi.useFakeTimers();
    mockListDirectory.mockResolvedValue([]);

    await act(async () => {
      renderWithI18n(<FileTree {...defaultProps} executionStatus="RUNNING" />);
    });

    // Initial load call
    const callsAfterMount = mockListDirectory.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Should have been called again after 2s interval
    expect(mockListDirectory.mock.calls.length).toBeGreaterThan(callsAfterMount);

    vi.useRealTimers();
  });

  it("stops auto-refresh interval when executionStatus is not RUNNING", async () => {
    vi.useFakeTimers();
    mockListDirectory.mockResolvedValue([]);

    await act(async () => {
      renderWithI18n(<FileTree {...defaultProps} executionStatus="COMPLETED" />);
    });

    const callsAfterMount = mockListDirectory.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    // No additional calls — interval not started
    expect(mockListDirectory.mock.calls.length).toBe(callsAfterMount);

    vi.useRealTimers();
  });

  it("preserves expanded folder state on auto-refresh", async () => {
    vi.useFakeTimers();
    const entries: FileEntry[] = [
      { name: "src", relativePath: "src", isDirectory: true },
    ];
    const childEntries: FileEntry[] = [
      { name: "index.ts", relativePath: "src/index.ts", isDirectory: false },
    ];
    mockListDirectory.mockImplementation((_: string, rel?: string) => {
      if (rel === "src") return Promise.resolve(childEntries);
      return Promise.resolve(entries);
    });

    await act(async () => {
      renderWithI18n(<FileTree {...defaultProps} executionStatus="RUNNING" />);
    });

    // Expand the src folder
    const srcFolder = screen.getByText("src");
    await act(async () => {
      fireEvent.click(srcFolder);
    });

    // index.ts should be visible
    expect(screen.getByText("index.ts")).toBeInTheDocument();

    // Advance timer to trigger refresh
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // After refresh, src should still be expanded and index.ts still visible
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("index.ts")).toBeInTheDocument();

    vi.useRealTimers();
  });
});

describe("FileTreeNode", () => {
  it.todo("shows ChevronRight for collapsed folder");
  it.todo("shows ChevronDown for expanded folder");
  it.todo("shows git status badge (M/A/D) when gitStatus is set");
  it.todo("shows inline rename input when renaming");
});
