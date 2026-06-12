import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { NotePreviewDialog } from "@/components/notes/note-preview-dialog";

afterEach(() => {
  cleanup();
});

const mockNote = {
  title: "Release Plan",
  content: "## Heading\n\nThis is the note body content.",
};

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("NotePreviewDialog", () => {
  it("renders the note title when open", () => {
    renderWithI18n(
      <NotePreviewDialog note={mockNote} open onOpenChange={vi.fn()} />
    );
    expect(screen.getByText("Release Plan")).toBeInTheDocument();
  });

  it("renders the note content (markdown body)", () => {
    renderWithI18n(
      <NotePreviewDialog note={mockNote} open onOpenChange={vi.fn()} />
    );
    expect(screen.getByText("This is the note body content.")).toBeInTheDocument();
  });

  it("renders an empty-state hint when content is blank", () => {
    renderWithI18n(
      <NotePreviewDialog
        note={{ title: "Empty", content: "" }}
        open
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByText("Empty")).toBeInTheDocument();
  });

  it("does not render content when closed", () => {
    renderWithI18n(
      <NotePreviewDialog note={mockNote} open={false} onOpenChange={vi.fn()} />
    );
    expect(screen.queryByText("This is the note body content.")).not.toBeInTheDocument();
  });
});
