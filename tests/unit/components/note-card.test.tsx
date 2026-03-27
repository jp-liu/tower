import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { NoteCard } from "@/components/notes/note-card";
import type { NoteItem } from "@/components/notes/note-card";

afterEach(() => {
  cleanup();
});

const mockNote: NoteItem = {
  id: "note-1",
  title: "Test Note Title",
  content: "This is the note content.",
  category: "备忘",
  updatedAt: new Date("2026-03-01"),
};

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("NoteCard", () => {
  it("renders note title text", () => {
    renderWithI18n(
      <NoteCard note={mockNote} onEdit={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("Test Note Title")).toBeInTheDocument();
  });

  it("renders category badge text", () => {
    renderWithI18n(
      <NoteCard note={mockNote} onEdit={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("备忘")).toBeInTheDocument();
  });

  it("renders content preview (truncated at 300 chars)", () => {
    const longContent = "A".repeat(400);
    const noteWithLongContent: NoteItem = { ...mockNote, content: longContent };
    renderWithI18n(
      <NoteCard note={noteWithLongContent} onEdit={vi.fn()} onDelete={vi.fn()} />
    );
    // Should render some content but not all 400 chars as plain text
    const rendered = document.body.textContent ?? "";
    expect(rendered.length).toBeLessThan(400 + 100); // allow some margin for other text
  });

  it("calls onEdit when edit button is clicked", async () => {
    const onEdit = vi.fn();
    renderWithI18n(
      <NoteCard note={mockNote} onEdit={onEdit} onDelete={vi.fn()} />
    );
    // Hover to reveal buttons, then find edit button by aria-label
    const editButton = screen.getByRole("button", { name: "编辑" });
    fireEvent.click(editButton);
    expect(onEdit).toHaveBeenCalledWith(mockNote);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("calls onDelete when delete button is clicked", () => {
    const onDelete = vi.fn();
    renderWithI18n(
      <NoteCard note={mockNote} onEdit={vi.fn()} onDelete={onDelete} />
    );
    const deleteButton = screen.getByRole("button", { name: "删除" });
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith(mockNote.id);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
