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

// Mock config-actions — return numeric debounceMs
vi.mock("@/actions/config-actions", () => ({
  getConfigValue: vi.fn().mockResolvedValue(250),
}));

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

describe("SearchDialog - race condition fix (SRCH-07)", () => {
  it("does not display stale results when query changes rapidly", async () => {
    const { globalSearch } = await import("@/actions/search-actions");
    const mockSearch = vi.mocked(globalSearch);

    // "stale" query resolves slowly; "fresh" query resolves immediately
    mockSearch.mockImplementation(async (query) => {
      if (query === "stale") {
        await new Promise((r) => setTimeout(r, 800));
        return [{ id: "old", type: "task" as const, title: "Old Result", subtitle: "ws", navigateTo: "/old" }];
      }
      return [{ id: "new", type: "task" as const, title: "New Result", subtitle: "ws", navigateTo: "/new" }];
    });

    renderDialog();

    const input = screen.getByPlaceholderText(/搜索/);
    const userEventMod = (await vi.importActual("@testing-library/user-event") as any).default;
    const user = userEventMod.setup();

    // Type "stale" query (fires debounce after 250ms) then immediately type "fresh"
    // The "stale" debounce timer fires, globalSearch("stale") starts its 800ms delay
    // Then "fresh" fires and resolves immediately — results should show "New Result"
    await user.type(input, "stale");

    // Small delay to let the debounce timer fire for "stale" (>250ms debounce)
    await new Promise((r) => setTimeout(r, 300));

    // Now type new query while "stale" request is still pending (< 800ms elapsed)
    await user.clear(input);
    await user.type(input, "fresh");

    // Wait for "fresh" results to appear
    await vi.waitFor(() => {
      expect(screen.getByText("New Result")).toBeInTheDocument();
    }, { timeout: 2000 });

    // "Old Result" should NOT be present (stale result suppressed by cancelled flag)
    expect(screen.queryByText("Old Result")).not.toBeInTheDocument();
  });
});

describe("SearchDialog - realtime config (CFG-02)", () => {
  it("re-fetches debounceMs config each time dialog opens", async () => {
    const { getConfigValue } = await import("@/actions/config-actions");
    const mockGetConfig = vi.mocked(getConfigValue);
    mockGetConfig.mockClear();

    const { rerender } = render(
      <I18nProvider>
        <SearchDialog open={true} onOpenChange={() => {}} />
      </I18nProvider>
    );

    // First open — getConfigValue should be called
    await vi.waitFor(() => {
      expect(mockGetConfig).toHaveBeenCalledWith("search.debounceMs", 250);
    });

    const callCountAfterFirstOpen = mockGetConfig.mock.calls.filter(
      (c) => c[0] === "search.debounceMs"
    ).length;

    // Close dialog
    rerender(
      <I18nProvider>
        <SearchDialog open={false} onOpenChange={() => {}} />
      </I18nProvider>
    );

    // Re-open dialog
    rerender(
      <I18nProvider>
        <SearchDialog open={true} onOpenChange={() => {}} />
      </I18nProvider>
    );

    // getConfigValue should be called again on re-open
    await vi.waitFor(() => {
      const totalCalls = mockGetConfig.mock.calls.filter(
        (c) => c[0] === "search.debounceMs"
      ).length;
      expect(totalCalls).toBeGreaterThan(callCountAfterFirstOpen);
    });
  });
});
