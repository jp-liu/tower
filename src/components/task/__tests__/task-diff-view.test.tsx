import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { TaskDiffView } from "@/components/task/task-diff-view";

// Mock DiffEditorView so tests don't load Monaco. The stub exposes the
// per-side content lengths so we can assert what was fed to the editor.
vi.mock("@/components/task/diff-editor", () => ({
  DiffEditorView: ({
    originalContent,
    modifiedContent,
    filePath,
    readOnly,
  }: {
    originalContent: string;
    modifiedContent: string;
    filePath: string;
    readOnly?: boolean;
  }) => (
    <div
      data-testid="diff-editor-stub"
      data-file={filePath}
      data-readonly={readOnly ? "true" : "false"}
      data-before-length={originalContent.length}
      data-after-length={modifiedContent.length}
    />
  ),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
});

function renderDiffView(opts: { isBinary?: boolean } = {}) {
  const isBinary = opts.isBinary ?? false;
  return render(
    <I18nProvider>
      <TaskDiffView
        taskId="ctaskid01234567890123"
        files={[
          {
            filename: "a.ts",
            added: isBinary ? 0 : 5,
            removed: 0,
            isBinary,
            patch: isBinary ? "" : "diff --git ...",
          },
        ]}
        totalAdded={isBinary ? 0 : 5}
        totalRemoved={0}
        hasConflicts={false}
        conflictFiles={[]}
      />
    </I18nProvider>
  );
}

describe("TaskDiffView — Monaco fetch-and-render flow", () => {
  it("on first expand: hits /diff-file, then renders DiffEditorView with before/after", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ before: "old line", after: "new line\nother", isBinary: false }),
    });

    renderDiffView();
    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    await act(async () => {
      fireEvent.click(fileButton);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/tasks/ctaskid01234567890123/diff-file");
    expect(url).toContain("file=a.ts");

    await waitFor(() => {
      expect(screen.getByTestId("diff-editor-stub")).toBeInTheDocument();
    });
    const stub = screen.getByTestId("diff-editor-stub");
    expect(stub.getAttribute("data-file")).toBe("a.ts");
    expect(stub.getAttribute("data-readonly")).toBe("true");
    expect(stub.getAttribute("data-before-length")).toBe("8");
    expect(stub.getAttribute("data-after-length")).toBe("14");
  });

  it("does NOT fetch or render DiffEditor for binary files; shows Binary badge", async () => {
    renderDiffView({ isBinary: true });
    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    await act(async () => {
      fireEvent.click(fileButton);
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("diff-editor-stub")).toBeNull();
    expect(screen.getByText("Binary")).toBeTruthy();
  });

  it("collapses without re-fetching; re-expanding the same file uses cached content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ before: "a", after: "b", isBinary: false }),
    });

    renderDiffView();
    const fileButton = screen.getByRole("button", { name: /a\.ts/i });

    // expand → fetch fires
    await act(async () => { fireEvent.click(fileButton); });
    await waitFor(() => expect(screen.getByTestId("diff-editor-stub")).toBeInTheDocument());

    // collapse — stub goes away
    await act(async () => { fireEvent.click(fileButton); });
    expect(screen.queryByTestId("diff-editor-stub")).toBeNull();

    // re-expand — stub returns, fetch count unchanged (cached)
    await act(async () => { fireEvent.click(fileButton); });
    await waitFor(() => expect(screen.getByTestId("diff-editor-stub")).toBeInTheDocument());
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("on fetch failure: shows Retry button instead of DiffEditor", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    renderDiffView();
    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    await act(async () => { fireEvent.click(fileButton); });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
    expect(screen.queryByTestId("diff-editor-stub")).toBeNull();
  });

  it("isBinary=true coming back from the endpoint shows binary-not-shown message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ before: null, after: null, isBinary: true }),
    });

    renderDiffView();
    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    await act(async () => { fireEvent.click(fileButton); });

    await waitFor(() => {
      expect(screen.getByText(/binary file/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("diff-editor-stub")).toBeNull();
  });
});
