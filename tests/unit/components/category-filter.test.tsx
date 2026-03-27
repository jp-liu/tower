import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { CategoryFilter } from "@/components/notes/category-filter";

afterEach(() => {
  cleanup();
});

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("CategoryFilter", () => {
  it('renders "All" button with zh label', () => {
    renderWithI18n(
      <CategoryFilter active="all" onSelect={vi.fn()} />
    );
    expect(screen.getByText("全部分类")).toBeInTheDocument();
  });

  it("renders all 4 preset category buttons", () => {
    renderWithI18n(
      <CategoryFilter active="all" onSelect={vi.fn()} />
    );
    expect(screen.getByText("账号")).toBeInTheDocument();
    expect(screen.getByText("环境")).toBeInTheDocument();
    expect(screen.getByText("需求")).toBeInTheDocument();
    expect(screen.getByText("备忘")).toBeInTheDocument();
  });

  it("active category button has active styling class", () => {
    renderWithI18n(
      <CategoryFilter active="账号" onSelect={vi.fn()} />
    );
    const activeButton = screen.getByText("账号");
    expect(activeButton.className).toMatch(/bg-amber-500\/20/);
  });

  it("calls onSelect with category value when a category button is clicked", () => {
    const onSelect = vi.fn();
    renderWithI18n(
      <CategoryFilter active="all" onSelect={onSelect} />
    );
    fireEvent.click(screen.getByText("需求"));
    expect(onSelect).toHaveBeenCalledWith("需求");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('calls onSelect with "all" when All button is clicked', () => {
    const onSelect = vi.fn();
    renderWithI18n(
      <CategoryFilter active="账号" onSelect={onSelect} />
    );
    fireEvent.click(screen.getByText("全部分类"));
    expect(onSelect).toHaveBeenCalledWith("all");
  });
});
