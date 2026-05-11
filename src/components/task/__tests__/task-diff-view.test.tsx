import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { I18nProvider } from "@/lib/i18n";
import { TaskDiffView } from "@/components/task/task-diff-view";

// Mock DiffView so tests don't depend on the real @git-diff-view/react library
vi.mock("@/components/task/diff-view", () => ({
  DiffView: ({ patch, language }: { patch: string; language?: string }) => (
    <div
      data-testid="diff-view-stub"
      data-language={language ?? "?"}
    >{`__DIFFVIEW__:${patch.length}`}</div>
  ),
}));

afterEach(() => {
  cleanup();
});

// Build a synthetic patch of 1000 lines
const bigPatch = Array.from({ length: 1000 }, (_, i) => `+ line ${i}`).join("\n");

function renderDiffView(patch: string, isBinary = false) {
  return render(
    <I18nProvider>
      <TaskDiffView
        files={[
          {
            filename: "a.ts",
            added: isBinary ? 0 : 1000,
            removed: 0,
            isBinary,
            patch,
          },
        ]}
        totalAdded={isBinary ? 0 : 1000}
        totalRemoved={0}
        hasConflicts={false}
        conflictFiles={[]}
      />
    </I18nProvider>
  );
}

describe("TaskDiffView — DiffView integration", () => {
  it("renders DiffView stub for a 1000-line patch after expanding", () => {
    renderDiffView(bigPatch);

    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    fireEvent.click(fileButton);

    // The DiffView stub should be present
    const stub = screen.getByTestId("diff-view-stub");
    expect(stub).toBeTruthy();
    // The stub content encodes the patch length
    expect(stub.textContent).toBe(`__DIFFVIEW__:${bigPatch.length}`);
  });

  it("passes the correct language to DiffView for a .ts file", () => {
    renderDiffView(bigPatch);

    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    fireEvent.click(fileButton);

    const stub = screen.getByTestId("diff-view-stub");
    expect(stub.getAttribute("data-language")).toBe("typescript");
  });

  it("does NOT show a truncation notice (truncation block is removed)", () => {
    const { container } = renderDiffView(bigPatch);

    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    fireEvent.click(fileButton);

    // No element should contain "showing first 500" or match the old pattern
    const allDivs = Array.from(container.querySelectorAll("div"));
    const truncNotice = allDivs.find(
      (el) =>
        el.textContent?.includes("500") &&
        el.classList.contains("border-t") &&
        el.classList.contains("py-2")
    );
    expect(truncNotice).toBeUndefined();
  });

  it("does NOT render DiffView for binary files; shows Binary badge instead", () => {
    renderDiffView("", true);

    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    fireEvent.click(fileButton);

    // DiffView stub must NOT be in the DOM
    expect(screen.queryByTestId("diff-view-stub")).toBeNull();

    // Binary badge must be visible
    expect(screen.getByText("Binary")).toBeTruthy();
  });

  it("renders a 10k-line patch without throwing within 2000ms", () => {
    const tenKPatch = Array.from({ length: 10000 }, (_, i) => `+ line ${i}`).join("\n");
    const start = performance.now();

    renderDiffView(tenKPatch);

    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    fireEvent.click(fileButton);

    const stub = screen.getByTestId("diff-view-stub");
    expect(stub).toBeTruthy();

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});
