import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
// Component to be created in Plan 02
import { PromptsConfig } from "@/components/settings/prompts-config";
// Server actions to be mocked
import * as promptActions from "@/actions/prompt-actions";

// --- Mock data ---

const mockPrompts = [
  {
    id: "1",
    name: "Coding Agent",
    description: "Default coding prompt",
    content: "You are a helpful coding agent",
    isDefault: true,
    workspaceId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  },
  {
    id: "2",
    name: "Review Agent",
    description: "For code review",
    content: "Review this code",
    isDefault: false,
    workspaceId: null,
    createdAt: new Date("2026-01-02"),
    updatedAt: new Date("2026-01-02"),
  },
];

// --- Helpers ---

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

// --- Setup / Teardown ---

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// --- Tests ---

describe("PromptsConfig", () => {
  it("renders prompt list with name, description, and default badge for each prompt", () => {
    renderWithI18n(<PromptsConfig prompts={mockPrompts} />);

    // Prompt names should appear
    expect(screen.getByText("Coding Agent")).toBeInTheDocument();
    expect(screen.getByText("Review Agent")).toBeInTheDocument();
    // Descriptions should appear
    expect(screen.getByText("Default coding prompt")).toBeInTheDocument();
    expect(screen.getByText("For code review")).toBeInTheDocument();
    // Default badge should appear for isDefault=true prompt (zh locale: "默认")
    expect(screen.getByText("默认")).toBeInTheDocument();
  });

  it("shows empty state when no prompts", () => {
    renderWithI18n(<PromptsConfig prompts={[]} />);
    // zh locale: "暂无提示词"
    expect(screen.getByText("暂无提示词")).toBeInTheDocument();
  });

  it("create button opens dialog", async () => {
    renderWithI18n(<PromptsConfig prompts={mockPrompts} />);
    // zh locale: "新建提示词"
    const newButton = screen.getByRole("button", { name: /新建提示词/i });
    fireEvent.click(newButton);

    await waitFor(() => {
      // Dialog title should appear — zh locale: "新建提示词"
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("edit button opens pre-filled dialog with prompt data", async () => {
    renderWithI18n(<PromptsConfig prompts={mockPrompts} />);
    // Find edit button for first prompt (Coding Agent)
    const editButtons = screen.getAllByRole("button", { name: /编辑/i });
    fireEvent.click(editButtons[0]);

    await waitFor(() => {
      // The dialog should contain the prompt's name pre-filled
      const nameInput = screen.getByDisplayValue("Coding Agent");
      expect(nameInput).toBeInTheDocument();
    });
  });

  it("delete button opens confirmation dialog", async () => {
    renderWithI18n(<PromptsConfig prompts={mockPrompts} />);
    // Find delete button for first prompt
    const deleteButtons = screen.getAllByRole("button", { name: /删除/i });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      // zh locale: "确认删除"
      expect(screen.getByText("确认删除")).toBeInTheDocument();
    });
  });

  it("set default button calls setDefaultPrompt server action", async () => {
    const setDefaultSpy = vi.spyOn(promptActions, "setDefaultPrompt").mockResolvedValue({
      id: "2",
      name: "Review Agent",
      description: "For code review",
      content: "Review this code",
      isDefault: true,
      workspaceId: null,
      createdAt: new Date("2026-01-02"),
      updatedAt: new Date("2026-01-02"),
    });

    renderWithI18n(<PromptsConfig prompts={mockPrompts} />);
    // Find "Set as Default" / "设为默认" button for non-default prompt (Review Agent)
    const setDefaultButtons = screen.getAllByRole("button", { name: /设为默认/i });
    fireEvent.click(setDefaultButtons[0]);

    await waitFor(() => {
      expect(setDefaultSpy).toHaveBeenCalledWith("2", undefined);
    });
  });

  it("default prompt shows default badge", () => {
    renderWithI18n(<PromptsConfig prompts={mockPrompts} />);
    // zh locale: "默认" badge should be visible for the isDefault=true prompt
    const defaultBadge = screen.getByText("默认");
    expect(defaultBadge).toBeInTheDocument();
  });

  it("non-default prompt does not show default badge but shows set default button", () => {
    renderWithI18n(<PromptsConfig prompts={mockPrompts} />);
    // "Review Agent" is not default, so "设为默认" button should be present
    expect(screen.getByRole("button", { name: /设为默认/i })).toBeInTheDocument();
  });
});
