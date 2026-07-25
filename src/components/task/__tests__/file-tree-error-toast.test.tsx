import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, act } from "@testing-library/react";

const mockListDirectory = vi.fn();
const mockGetGitStatus = vi.fn(async (...args: unknown[]) => {
  void args;
  return {};
});
const mockListAllFiles = vi.fn(async (...args: unknown[]) => {
  void args;
  return [] as string[];
});
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastWarning = vi.fn();

vi.mock("@/actions/file-actions", () => ({
  listDirectory: (...args: unknown[]) => mockListDirectory(...args),
  getGitStatus: (...args: unknown[]) => mockGetGitStatus(...args),
  createFile: vi.fn().mockResolvedValue(undefined),
  createDirectory: vi.fn().mockResolvedValue(undefined),
  renameEntry: vi.fn().mockResolvedValue(undefined),
  deleteEntry: vi.fn().mockResolvedValue(undefined),
  listAllFiles: (...args: unknown[]) => mockListAllFiles(...args),
  revealInFinder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
    warning: (...args: unknown[]) => mockToastWarning(...args),
    info: vi.fn(),
  },
}));

// Mock next/cache for any indirect server action import
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { FileTree } from "@/components/task/file-tree";
import { I18nProvider } from "@/lib/i18n";

const defaultProps = {
  worktreePath: "/wt",
  baseBranch: null,
  worktreeBranch: null,
  executionStatus: "IDLE",
  onFileSelect: () => {},
};

beforeEach(() => {
  mockListDirectory.mockReset();
  mockGetGitStatus.mockReset().mockResolvedValue({});
  mockListAllFiles.mockReset().mockResolvedValue([]);
  mockToastError.mockReset();
  mockToastSuccess.mockReset();
  mockToastWarning.mockReset();
});

afterEach(() => {
  cleanup();
});

function renderTree(props = defaultProps) {
  return render(
    <I18nProvider>
      <FileTree {...props} />
    </I18nProvider>
  );
}

describe("FileTree silent-catch replacement", () => {
  it("Test 1: listDirectory failure shows toast.error with retry action", async () => {
    mockListDirectory.mockRejectedValueOnce(new Error("EACCES"));

    await act(async () => {
      renderTree();
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });

    const call = mockToastError.mock.calls[0];
    // First arg is the message; opts are second
    expect(typeof call[0]).toBe("string");
    expect(call[1]).toBeDefined();
    expect(call[1].action).toBeDefined();
    expect(typeof call[1].action.label).toBe("string");
    expect(typeof call[1].action.onClick).toBe("function");
  });

  it("Test 2: clicking retry re-invokes listDirectory", async () => {
    mockListDirectory.mockRejectedValueOnce(new Error("EACCES"));

    await act(async () => {
      renderTree();
    });

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());

    const initialCalls = mockListDirectory.mock.calls.length;

    // Reset list mock to succeed on retry
    mockListDirectory.mockResolvedValueOnce([]);
    const retry = mockToastError.mock.calls[0][1].action.onClick;

    await act(async () => {
      retry();
    });

    await waitFor(() => {
      expect(mockListDirectory.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });
});
