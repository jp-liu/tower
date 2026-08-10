import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { TaskMergeConfirmDialog } from "../task-merge-confirm-dialog";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/actions/config-actions", () => ({ setConfigValue: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));

describe("TaskMergeConfirmDialog conflict callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("keeps the dialog open, exposes conflict files once, and does not complete", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ conflictFiles: ["src/a.ts", "src/b.ts"] }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    const onMergeComplete = vi.fn();
    const onMergeConflict = vi.fn(async () => undefined);

    render(
      <I18nProvider>
        <TaskMergeConfirmDialog
          open
          onOpenChange={onOpenChange}
          taskId="task-1"
          taskTitle="Conflict task"
          baseBranch="main"
          fileCount={2}
          commitCount={1}
          onMergeComplete={onMergeComplete}
          onMergeConflict={onMergeConflict}
          conflictFeedback={<p>冲突信息已提交给 Agent</p>}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认合并" }));

    await waitFor(() => expect(onMergeConflict).toHaveBeenCalledWith({
      taskId: "task-1",
      baseBranch: "main",
      conflictFiles: ["src/a.ts", "src/b.ts"],
    }));
    expect(onMergeConflict).toHaveBeenCalledTimes(1);
    expect(onMergeComplete).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByText(/检测到合并冲突/)).toBeInTheDocument();
    expect(screen.getByText("冲突信息已提交给 Agent")).toBeInTheDocument();
  });
});
