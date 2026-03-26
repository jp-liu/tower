import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BoardStats } from "@/components/board/board-stats";

afterEach(() => {
  cleanup();
});

describe("BoardStats", () => {
  it("renders task count", () => {
    render(<BoardStats totalTasks={5} runningTasks={3} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders running task count", () => {
    render(<BoardStats totalTasks={5} runningTasks={3} />);
    const allThrees = screen.getAllByText("3");
    const boldThree = allThrees.find(
      (el) => el.className.includes("text-2xl")
    );
    expect(boldThree).toBeInTheDocument();
  });

  it("renders section labels", () => {
    render(<BoardStats totalTasks={1} runningTasks={0} />);
    // i18n defaults to zh
    expect(screen.getByText("概览")).toBeInTheDocument();
    expect(screen.getByText("执行中")).toBeInTheDocument();
    expect(screen.getByText("提示")).toBeInTheDocument();
  });
});
