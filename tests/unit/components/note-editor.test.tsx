import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NoteEditor } from "@/components/notes/note-editor";

afterEach(() => {
  cleanup();
});

describe("NoteEditor", () => {
  it("renders with initial value in textarea", () => {
    render(<NoteEditor value="Initial content" onChange={vi.fn()} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Initial content");
  });

  it("calls onChange when user types in textarea", () => {
    const onChange = vi.fn();
    render(<NoteEditor value="" onChange={onChange} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "New text" } });
    expect(onChange).toHaveBeenCalledWith("New text");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("renders a preview panel alongside the textarea", () => {
    render(<NoteEditor value="**Bold text**" onChange={vi.fn()} />);
    // textarea exists
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    // preview content rendered via ReactMarkdown - look for the prose container
    const container = document.querySelector(".prose");
    expect(container).toBeInTheDocument();
  });

  it("renders without error when value is empty", () => {
    expect(() => {
      render(<NoteEditor value="" onChange={vi.fn()} />);
    }).not.toThrow();
  });
});
