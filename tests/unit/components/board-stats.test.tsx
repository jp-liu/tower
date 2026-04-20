import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BoardStats } from "@/components/board/board-stats";
import { I18nProvider } from "@/lib/i18n";

afterEach(() => {
  cleanup();
});

describe("BoardStats", () => {
  it("renders task count", () => {
    render(<I18nProvider><BoardStats totalTasks={5} runningTasks={3} /></I18nProvider>);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders running task count", () => {
    render(<I18nProvider><BoardStats totalTasks={5} runningTasks={3} /></I18nProvider>);
    const allThrees = screen.getAllByText("3");
    const boldThree = allThrees.find(
      (el) => el.className.includes("text-2xl")
    );
    expect(boldThree).toBeInTheDocument();
  });

  it("renders section labels", () => {
    render(<I18nProvider><BoardStats totalTasks={1} runningTasks={0} /></I18nProvider>);
    // i18n defaults to zh
    expect(screen.getByText("概览")).toBeInTheDocument();
    expect(screen.getByText("执行中")).toBeInTheDocument();
    expect(screen.getByText("提示")).toBeInTheDocument();
  });
});
