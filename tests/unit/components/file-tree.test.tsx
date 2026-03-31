import { vi, describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Stub mocks for server actions — Plan 03 fills these tests
vi.mock("@/actions/file-actions", () => ({
  listDirectory: vi.fn().mockResolvedValue([]),
  getGitStatus: vi.fn().mockResolvedValue({}),
}));

describe("FileTree", () => {
  it.todo("renders empty state when worktreePath is null");
  it.todo("renders file nodes returned by listDirectory");
  it.todo("clicking a file node calls onFileSelect with absolute path");
  it.todo("starts auto-refresh interval when executionStatus is RUNNING");
  it.todo("stops auto-refresh interval when executionStatus is not RUNNING");
  it.todo("preserves expanded folder state on auto-refresh");
});

describe("FileTreeNode", () => {
  it.todo("shows ChevronRight for collapsed folder");
  it.todo("shows ChevronDown for expanded folder");
  it.todo("shows git status badge (M/A/D) when gitStatus is set");
  it.todo("shows inline rename input when renaming");
});
