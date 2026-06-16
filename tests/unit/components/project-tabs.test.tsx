import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProjectTabs } from "@/components/board/project-tabs";
import { I18nProvider } from "@/lib/i18n";

afterEach(() => {
  cleanup();
});

const projects = [
  { id: "p1", name: "alpha", alias: "项目一", totalTasks: 30, runningTasks: 5 },
  { id: "p2", name: "beta", alias: null, totalTasks: 8, runningTasks: 0 },
];

function renderTabs() {
  return render(
    <I18nProvider>
      <ProjectTabs projects={projects} activeProjectId="p1" onSelect={() => {}} />
    </I18nProvider>
  );
}

describe("ProjectTabs", () => {
  it("renders project names", () => {
    renderTabs();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("renders the alias when present", () => {
    renderTabs();
    expect(screen.getByText("项目一")).toBeInTheDocument();
  });

  it("renders a running/total badge for each project", () => {
    renderTabs();
    // p1: running 5 / total 30
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    // p2: running 0 / total 8
    expect(screen.getByText("8")).toBeInTheDocument();
  });
});
