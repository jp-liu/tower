import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { I18nProvider } from "@/lib/i18n";
import { TaskDiffView } from "@/components/task/task-diff-view";

afterEach(() => {
  cleanup();
});

// Build a synthetic patch of 1000 lines
const bigPatch = Array.from({ length: 1000 }, (_, i) => `+ line ${i}`).join("\n");

function renderDiffView(patch: string) {
  return render(
    <I18nProvider>
      <TaskDiffView
        files={[
          {
            filename: "a.ts",
            added: 1000,
            removed: 0,
            isBinary: false,
            patch,
          },
        ]}
        totalAdded={1000}
        totalRemoved={0}
        hasConflicts={false}
        conflictFiles={[]}
      />
    </I18nProvider>
  );
}

describe("TaskDiffView — patch truncation", () => {
  it("renders at most 500 line spans when patch has 1000 lines", () => {
    renderDiffView(bigPatch);

    // Expand the file by clicking the header button
    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    fireEvent.click(fileButton);

    // Count spans inside the pre element (each rendered line is a <span>)
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    const spans = pre!.querySelectorAll("span");
    expect(spans.length).toBeLessThanOrEqual(500);
  });

  it("shows truncation notice with total line count when patch exceeds 500 lines", () => {
    const { container } = renderDiffView(bigPatch);

    // Expand the file
    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    fireEvent.click(fileButton);

    // The truncation notice div appears after the <pre>
    // The i18nProvider defaults to "zh": "差异内容过大，已截断显示前 {n} 行（共 {total} 行）"
    // It contains "500" (TRUNCATE_AT) and "1000" (total lines)
    const noticeDiv = container.querySelector(".border-t.border-border:not(div > .border-t.border-border.bg-background)");
    // Find the div containing the truncation text by checking text content
    const allDivs = Array.from(container.querySelectorAll("div"));
    const truncNotice = allDivs.find(
      (el) => el.textContent?.includes("500") && el.textContent?.includes("1000") && el.classList.contains("border-t")
    );
    expect(truncNotice).toBeTruthy();
    expect(truncNotice!.textContent).toMatch(/1000/);
  });

  it("does NOT show truncation notice for a small patch (< 500 lines)", () => {
    const smallPatch = Array.from({ length: 10 }, (_, i) => `+ line ${i}`).join("\n");
    const { container } = renderDiffView(smallPatch);

    const fileButton = screen.getByRole("button", { name: /a\.ts/i });
    fireEvent.click(fileButton);

    // No truncation notice div — no element with both "500" and border-t after <pre>
    const allDivs = Array.from(container.querySelectorAll("div"));
    const truncNotice = allDivs.find(
      (el) =>
        el.textContent?.includes("500") &&
        el.classList.contains("border-t") &&
        el.classList.contains("py-2")
    );
    expect(truncNotice).toBeUndefined();
  });
});
