import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";

// Server actions are async server functions — mock them for the client component.
vi.mock("@/actions/note-actions", () => ({
  getTaskNotes: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock("@/actions/asset-actions", () => ({
  getTaskAssets: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
}));

import { getTaskNotes } from "@/actions/note-actions";
import { getTaskAssets } from "@/actions/asset-actions";
import { TaskNotesPanel } from "@/components/task/task-notes-panel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockNote = {
  id: "note-1",
  title: "Design Doc",
  content: "The note body that should appear in the preview.",
  createdAt: new Date("2026-03-01"),
};

beforeEach(() => {
  vi.mocked(getTaskNotes).mockResolvedValue([mockNote] as never);
  vi.mocked(getTaskAssets).mockResolvedValue([] as never);
});

function renderPanel() {
  return render(
    <I18nProvider>
      <TaskNotesPanel taskId="task-1" projectId="project-1" />
    </I18nProvider>
  );
}

describe("TaskNotesPanel — note preview", () => {
  it("renders the fetched note title", async () => {
    renderPanel();
    expect(await screen.findByText("Design Doc")).toBeInTheDocument();
  });

  it("opens the note preview dialog when the note title is clicked", async () => {
    renderPanel();
    // No preview dialog before interaction.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const title = await screen.findByText("Design Doc");
    fireEvent.click(title);

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("The note body that should appear in the preview.")
    ).toBeInTheDocument();
  });

  it("exposes a preview button for each note", async () => {
    renderPanel();
    await screen.findByText("Design Doc");
    const previewButtons = screen.getAllByRole("button", { name: "预览备注" });
    expect(previewButtons.length).toBeGreaterThan(0);
  });
});
