// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CreateTaskDialog } from "@/components/board/create-task-dialog";
import { I18nProvider } from "@/lib/i18n";
import type { Task } from "@prisma/client";

// Mock server actions
vi.mock("@/actions/git-actions", () => ({
  getProjectBranches: vi.fn().mockResolvedValue(["main", "develop"]),
  getCurrentBranch: vi.fn().mockResolvedValue("main"),
  fetchRemoteBranches: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/actions/label-actions", () => ({
  getLabelsForWorkspace: vi.fn().mockResolvedValue([]),
  setTaskLabels: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/actions/task-actions", () => ({
  createTask: vi.fn().mockResolvedValue({}),
  updateTask: vi.fn().mockResolvedValue({}),
}));

// Mock next/cache to prevent errors in test environment
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { getProjectBranches } from "@/actions/git-actions";

const mockedGetProjectBranches = vi.mocked(getProjectBranches);

function renderDialog(props: Partial<Parameters<typeof CreateTaskDialog>[0]> = {}) {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    onUpdate: vi.fn(),
    labels: [],
    ...props,
  };
  return render(
    <I18nProvider>
      <CreateTaskDialog {...defaultProps} />
    </I18nProvider>
  );
}

const mockEditTask: Task = {
  id: "task-1",
  title: "Existing Task",
  description: "Some description",
  status: "TODO",
  priority: "MEDIUM",
  order: 0,
  promptId: null,
  projectId: "proj-1",
  baseBranch: null,
  subPath: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockedGetProjectBranches.mockResolvedValue(["main", "develop"]);
});

describe("CreateTaskDialog - branch selector", () => {
  it("renders branch selector for GIT project", async () => {
    renderDialog({
      projectType: "GIT",
      projectLocalPath: "/some/path",
    });

    // Wait for branches to load — selected branch "main" appears in trigger button
    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
    });

    // Open the dropdown to see all branch options
    const branchTrigger = screen.getByTestId("branch-selector").querySelector("button")!;
    fireEvent.click(branchTrigger);

    await waitFor(() => {
      expect(screen.getByText("develop")).toBeInTheDocument();
    });
    expect(mockedGetProjectBranches).toHaveBeenCalledWith("/some/path");
  });

  it("hides branch selector for NORMAL project", async () => {
    renderDialog({
      projectType: "NORMAL",
    });

    // Allow any async operations to settle
    await waitFor(() => {
      expect(screen.getByTestId("task-title")).toBeInTheDocument();
    });

    // Branch selector should not be visible
    expect(screen.queryByText("main")).not.toBeInTheDocument();
    expect(screen.queryByText("develop")).not.toBeInTheDocument();
    expect(mockedGetProjectBranches).not.toHaveBeenCalled();
  });

  it("includes baseBranch in onSubmit for GIT project", async () => {
    const onSubmit = vi.fn();
    renderDialog({
      projectType: "GIT",
      projectLocalPath: "/some/path",
      onSubmit,
    });

    // Wait for branches to load
    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
    });

    // Fill in title
    const titleInput = screen.getByTestId("task-title");
    fireEvent.change(titleInput, { target: { value: "My new task" } });

    // Submit the form
    const createButton = screen.getByText("创建");
    fireEvent.click(createButton);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        baseBranch: "main",
        title: "My new task",
      })
    );
  });

  it("does not render branch selector in edit mode", async () => {
    const onUpdate = vi.fn();
    renderDialog({
      projectType: "GIT",
      projectLocalPath: "/some/path",
      editTask: mockEditTask,
      editTaskLabelIds: [],
      onUpdate,
    });

    // Allow any async operations to settle
    await waitFor(() => {
      expect(screen.getByTestId("task-title")).toBeInTheDocument();
    });

    // Branch selector should not be visible in edit mode
    expect(screen.queryByText("main")).not.toBeInTheDocument();
    expect(screen.queryByText("develop")).not.toBeInTheDocument();
    expect(mockedGetProjectBranches).not.toHaveBeenCalled();
  });
});
