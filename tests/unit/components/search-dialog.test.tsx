// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SearchDialog } from "@/components/layout/search-dialog";
import { I18nProvider } from "@/lib/i18n";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock globalSearch server action — return controlled results
vi.mock("@/actions/search-actions", async () => {
  const actual = await vi.importActual("@/actions/search-actions");
  return {
    ...actual,
    globalSearch: vi.fn().mockResolvedValue([]),
  };
});

function renderDialog() {
  return render(
    <I18nProvider>
      <SearchDialog open={true} onOpenChange={() => {}} />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SearchDialog - tabs", () => {
  it("renders six category tabs", () => {
    renderDialog();
    // zh locale defaults: 全部, 任务, 项目, 仓库, 笔记, 资源
    expect(screen.getByText("全部")).toBeInTheDocument();
    expect(screen.getByText("任务")).toBeInTheDocument();
    expect(screen.getByText("项目")).toBeInTheDocument();
    expect(screen.getByText("仓库")).toBeInTheDocument();
    expect(screen.getByText("笔记")).toBeInTheDocument();
    expect(screen.getByText("资源")).toBeInTheDocument();
  });

  it("All tab is selected by default", () => {
    renderDialog();
    // The All tab button should have the active styling class
    const allTab = screen.getByText("全部").closest("button");
    expect(allTab).toBeTruthy();
    expect(allTab?.className).toContain("amber");
  });
});

describe("SearchDialog - grouped All rendering", () => {
  it("renders section headers when All tab has grouped results", async () => {
    const { globalSearch } = await import("@/actions/search-actions");
    const mockSearch = vi.mocked(globalSearch);
    mockSearch.mockResolvedValue([
      { id: "t1", type: "task", title: "Task Result", subtitle: "ws / proj", navigateTo: "/workspaces/w1" },
      { id: "n1", type: "note", title: "Note Result", subtitle: "ws / proj", navigateTo: "/workspaces/w1", snippet: "note content preview" },
    ]);

    renderDialog();

    // Type a query to trigger search
    const input = screen.getByPlaceholderText(/搜索/);
    await vi.importActual("@testing-library/user-event").then(async (mod: any) => {
      const userEvent = mod.default;
      const user = userEvent.setup();
      await user.type(input, "test");
    });

    // Wait for debounced search results
    await vi.waitFor(() => {
      // Section headers should appear for types that have results
      // "任务" appears as both tab label and section header
      const taskHeaders = screen.getAllByText("任务");
      expect(taskHeaders.length).toBeGreaterThanOrEqual(2); // tab + section header
    }, { timeout: 1000 });
  });
});

describe("SearchDialog - snippet rendering", () => {
  it("renders snippet text beneath result subtitle when present", async () => {
    const { globalSearch } = await import("@/actions/search-actions");
    const mockSearch = vi.mocked(globalSearch);
    mockSearch.mockResolvedValue([
      { id: "n1", type: "note", title: "My Note", subtitle: "ws / proj", navigateTo: "/w1", snippet: "This is a snippet preview" },
    ]);

    renderDialog();

    const input = screen.getByPlaceholderText(/搜索/);
    await vi.importActual("@testing-library/user-event").then(async (mod: any) => {
      const userEvent = mod.default;
      const user = userEvent.setup();
      await user.type(input, "note");
    });

    await vi.waitFor(() => {
      expect(screen.getByText("This is a snippet preview")).toBeInTheDocument();
    }, { timeout: 1000 });
  });

  it("does not render snippet line when snippet is undefined", async () => {
    const { globalSearch } = await import("@/actions/search-actions");
    const mockSearch = vi.mocked(globalSearch);
    mockSearch.mockResolvedValue([
      { id: "t1", type: "task", title: "Plain Task", subtitle: "ws / proj", navigateTo: "/w1" },
    ]);

    renderDialog();

    const input = screen.getByPlaceholderText(/搜索/);
    await vi.importActual("@testing-library/user-event").then(async (mod: any) => {
      const userEvent = mod.default;
      const user = userEvent.setup();
      await user.type(input, "task");
    });

    await vi.waitFor(() => {
      expect(screen.getByText("Plain Task")).toBeInTheDocument();
      // The result row should have exactly 2 child divs (title + subtitle), no snippet div
      const resultButton = screen.getByText("Plain Task").closest("button");
      const textContainer = resultButton?.querySelector(".flex-1");
      const childDivs = textContainer?.querySelectorAll(":scope > div");
      expect(childDivs?.length).toBe(2); // title + subtitle only, no snippet
    }, { timeout: 1000 });
  });
});
