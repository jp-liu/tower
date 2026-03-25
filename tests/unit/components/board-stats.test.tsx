import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BoardStats } from "@/components/board/board-stats";

afterEach(() => {
  cleanup();
});

describe("BoardStats", () => {
  it("renders task count", () => {
    render(<BoardStats totalTasks={5} runningTasks={3} tip="Test tip" />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders running task count", () => {
    render(<BoardStats totalTasks={5} runningTasks={3} tip="Test tip" />);
    const allThrees = screen.getAllByText("3");
    const boldThree = allThrees.find(
      (el) => el.className.includes("text-2xl")
    );
    expect(boldThree).toBeInTheDocument();
  });

  it("renders workflow tip", () => {
    render(<BoardStats totalTasks={5} runningTasks={3} tip="My workflow tip" />);
    expect(screen.getByText("My workflow tip")).toBeInTheDocument();
  });

  it("renders tip description when provided", () => {
    render(
      <BoardStats
        totalTasks={1}
        runningTasks={0}
        tip="Tip"
        tipDescription="Detailed tip"
      />
    );
    expect(screen.getByText("Detailed tip")).toBeInTheDocument();
  });

  it("renders section labels", () => {
    render(<BoardStats totalTasks={1} runningTasks={0} tip="Tip" />);
    expect(screen.getByText("项目概览")).toBeInTheDocument();
    expect(screen.getByText("执行状态")).toBeInTheDocument();
    expect(screen.getByText("工作流提示")).toBeInTheDocument();
  });
});
