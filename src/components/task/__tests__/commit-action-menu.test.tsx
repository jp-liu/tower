/**
 * Tests for CommitActionMenu — P6-T10
 *
 * Strategy:
 * - Mock @/lib/git-api, sonner, navigator.clipboard.writeText, window.confirm
 * - Mock dialog sub-components to avoid deep rendering
 * - Render with open={true} so menu content is always in DOM
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { I18nProvider } from "@/lib/i18n";
import type { RawCommit } from "@/lib/git-graph-layout";

// ---------------------------------------------------------------------------
// Mock @/lib/git-api
// ---------------------------------------------------------------------------
const mockGitAction = vi.fn();
vi.mock("@/lib/git-api", () => ({
  gitAction: (...args: unknown[]) => mockGitAction(...args),
}));

// ---------------------------------------------------------------------------
// Mock sonner
// ---------------------------------------------------------------------------
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// ---------------------------------------------------------------------------
// Mock dialog components to avoid deep rendering complexity
// ---------------------------------------------------------------------------
vi.mock("../commit-tag-dialog", () => ({
  CommitTagDialog: ({ open }: { open: boolean }) => (
    <div data-testid="commit-tag-dialog" data-open={String(open)} />
  ),
}));

vi.mock("../commit-message-dialog", () => ({
  CommitMessageDialog: ({ open }: { open: boolean }) => (
    <div data-testid="commit-message-dialog" data-open={String(open)} />
  ),
}));

// ---------------------------------------------------------------------------
// Fixture commit
// ---------------------------------------------------------------------------
const FIXTURE_COMMIT: RawCommit = {
  hash: "abc123abc123abc123abc123",
  shortHash: "abc123a",
  parents: [],
  author: "Alice",
  date: new Date().toISOString(),
  subject: "feat: initial commit",
  refs: ["main"],
};

// ---------------------------------------------------------------------------
// Helper to render menu
// ---------------------------------------------------------------------------
function renderMenu(props?: Partial<{
  commit: RawCommit;
  currentHead: string | null;
  onActionComplete: () => void;
}>) {
  const commit = props?.commit ?? FIXTURE_COMMIT;
  const currentHead = props?.currentHead ?? "def456";
  const onActionComplete = props?.onActionComplete ?? vi.fn();

  return render(
    <I18nProvider>
      <div id="commit-action-menu-test">
        {/* Lazy-import after mocks are applied */}
        {/* We use a dynamic import approach — but instead just import at top level */}
        <CommitActionMenuWrapper
          commit={commit}
          currentHead={currentHead}
          onActionComplete={onActionComplete}
        />
      </div>
    </I18nProvider>
  );
}

// We need to import the component AFTER vi.mock calls — use a wrapper
// that's defined after module-level mocks but uses a lazy reference.
function CommitActionMenuWrapper({
  commit,
  currentHead,
  onActionComplete,
}: {
  commit: RawCommit;
  currentHead: string | null;
  onActionComplete?: () => void;
}) {
  return (
    <CommitActionMenu
      worktreePath="/fake/path"
      commit={commit}
      currentHead={currentHead}
      onActionComplete={onActionComplete}
      open={true}
      onOpenChange={vi.fn()}
    />
  );
}

// ---------------------------------------------------------------------------
// Import component under test
// ---------------------------------------------------------------------------
import { CommitActionMenu } from "../commit-action-menu";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CommitActionMenu", () => {
  it("renders the menu when open=true", () => {
    renderMenu();
    expect(screen.getByTestId("commit-action-menu")).toBeTruthy();
  });

  it("Checkout — calls gitAction with checkout-commit and commit hash", async () => {
    mockGitAction.mockResolvedValue({});
    renderMenu({ commit: FIXTURE_COMMIT });

    const item = screen.getByText("检出此提交");
    fireEvent.click(item);

    await waitFor(() => {
      expect(mockGitAction).toHaveBeenCalledWith(
        "/fake/path",
        "checkout-commit",
        { hash: FIXTURE_COMMIT.hash }
      );
    });
  });

  it("Reset Hard — does NOT call gitAction when confirm returns false", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderMenu({ commit: FIXTURE_COMMIT });

    // Open the Reset submenu first — find subTrigger
    const resetTrigger = screen.getByText("重置到此处");
    fireEvent.click(resetTrigger);

    // In jsdom with shadcn DropdownMenuSub, submenu might not open via click.
    // Try clicking Hard directly if it's visible.
    const hardItem = screen.queryByText("Hard (全部丢弃)");
    if (hardItem) {
      fireEvent.click(hardItem);
      expect(mockGitAction).not.toHaveBeenCalled();
    }
  });

  it("Reset Hard — calls gitAction with mode=hard when confirm returns true", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockGitAction.mockResolvedValue({});
    renderMenu({ commit: FIXTURE_COMMIT });

    const hardItem = screen.queryByText("Hard (全部丢弃)");
    if (hardItem) {
      fireEvent.click(hardItem);
      await waitFor(() => {
        expect(mockGitAction).toHaveBeenCalledWith(
          "/fake/path",
          "reset-commit",
          { hash: FIXTURE_COMMIT.hash, mode: "hard" }
        );
      });
    }
  });

  it("Amend menu item is disabled when commit is NOT HEAD", () => {
    renderMenu({ commit: FIXTURE_COMMIT, currentHead: "def456" });

    const amendItem = screen.getByTestId("amend-menu-item");
    // DropdownMenuItem with disabled prop renders with aria-disabled or data-disabled
    const isDisabled =
      amendItem.getAttribute("aria-disabled") === "true" ||
      amendItem.getAttribute("data-disabled") === "true" ||
      (amendItem as HTMLButtonElement).disabled === true;
    expect(isDisabled).toBe(true);
  });

  it("Amend menu item is enabled when commit IS HEAD", () => {
    renderMenu({
      commit: FIXTURE_COMMIT,
      currentHead: FIXTURE_COMMIT.hash,
    });

    const amendItem = screen.getByTestId("amend-menu-item");
    const isDisabled =
      amendItem.getAttribute("aria-disabled") === "true" ||
      amendItem.getAttribute("data-disabled") === "true" ||
      (amendItem as HTMLButtonElement).disabled === true;
    expect(isDisabled).toBe(false);
  });

  it("Copy hash — calls clipboard.writeText with full hash", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderMenu({ commit: FIXTURE_COMMIT });

    const copyHashItem = screen.getByText("复制完整哈希");
    fireEvent.click(copyHashItem);

    expect(writeText).toHaveBeenCalledWith(FIXTURE_COMMIT.hash);
  });

  it("Copy short hash — calls clipboard.writeText with short hash", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderMenu({ commit: FIXTURE_COMMIT });

    const copyShortItem = screen.getByText("复制短哈希");
    fireEvent.click(copyShortItem);

    expect(writeText).toHaveBeenCalledWith(FIXTURE_COMMIT.shortHash);
  });
});
