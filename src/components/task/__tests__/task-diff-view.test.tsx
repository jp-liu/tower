import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { TaskDiffView } from "@/components/task/task-diff-view";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
});

interface FileSpec {
  filename: string;
  added: number;
  removed: number;
  isBinary?: boolean;
}

function renderDiffView(files: FileSpec[] = [{ filename: "a.ts", added: 5, removed: 1 }]) {
  return render(
    <I18nProvider>
      <TaskDiffView
        taskId="ctaskid01234567890123"
        files={files.map((f) => ({
          filename: f.filename,
          added: f.added,
          removed: f.removed,
          isBinary: f.isBinary ?? false,
          patch: "",
        }))}
        totalAdded={files.reduce((s, f) => s + f.added, 0)}
        totalRemoved={files.reduce((s, f) => s + f.removed, 0)}
        hasConflicts={false}
        conflictFiles={[]}
      />
    </I18nProvider>
  );
}

const SAMPLE_PATCH = [
  "diff --git a/a.ts b/a.ts",
  "index 0000000..1111111 100644",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1,3 +1,3 @@",
  " context",
  "-old line",
  "+new line",
].join("\n");

describe("TaskDiffView — lazy patch fetch + inline highlight", () => {
  it("auto-fetches /diff-patch on first expand for small files and renders the patch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ kind: "tracked", patch: SAMPLE_PATCH }),
    });

    renderDiffView();
    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    await act(async () => { fireEvent.click(fileButton); });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/tasks/ctaskid01234567890123/diff-patch");
    expect(url).toContain("file=a.ts");

    await waitFor(() => {
      // The added line renders with the green class
      expect(screen.getByText("+new line")).toBeInTheDocument();
      expect(screen.getByText("-old line")).toBeInTheDocument();
    });
  });

  it("does NOT auto-fetch for files over the line limit; shows fold UI instead", async () => {
    renderDiffView([{ filename: "big.lock", added: 500, removed: 500 }]);
    const fileButton = screen.getByRole("button", { name: /big\.lock/i });
    await act(async () => { fireEvent.click(fileButton); });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByText(/加载差异|Load diff/)).toBeInTheDocument();
    expect(screen.getByText(/差异较大|Large diff/)).toBeInTheDocument();
  });

  it("fold UI loads the patch on click", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ kind: "tracked", patch: SAMPLE_PATCH }),
    });

    renderDiffView([{ filename: "big.lock", added: 500, removed: 500 }]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /big\.lock/i })); });

    const loadBtn = screen.getByRole("button", { name: /加载差异|Load diff/ });
    await act(async () => { fireEvent.click(loadBtn); });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText("+new line")).toBeInTheDocument();
    });
  });

  it("does NOT fetch for binary files; shows the Binary badge", async () => {
    renderDiffView([{ filename: "img.png", added: 0, removed: 0, isBinary: true }]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /img\.png/i })); });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByText(/Binary|二进制/i)).toBeInTheDocument();
  });

  it("collapses without re-fetching; re-expanding uses cached patch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ kind: "tracked", patch: SAMPLE_PATCH }),
    });

    renderDiffView();
    const fileButton = screen.getByRole("button", { name: /a\.ts/i });

    await act(async () => { fireEvent.click(fileButton); });
    await waitFor(() => expect(screen.getByText("+new line")).toBeInTheDocument());

    await act(async () => { fireEvent.click(fileButton); });
    expect(screen.queryByText("+new line")).toBeNull();

    await act(async () => { fireEvent.click(fileButton); });
    await waitFor(() => expect(screen.getByText("+new line")).toBeInTheDocument());
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("on fetch failure: shows Retry button", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    renderDiffView();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /a\.ts/i })); });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /重试|Retry/ })).toBeInTheDocument();
    });
  });

  it("server kind=binary shows the binary-not-shown body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ kind: "binary", patch: "" }),
    });

    renderDiffView();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /a\.ts/i })); });

    await waitFor(() => {
      // ExpandedPatch body for kind=binary
      expect(screen.getByText(/Binary file|二进制文件/)).toBeInTheDocument();
    });
  });
});
