// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StopPreviewConfirmDialog } from "@/components/task/stop-preview-confirm-dialog";
import { I18nProvider } from "@/lib/i18n";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("StopPreviewConfirmDialog", () => {
  it("shows other-tabs count in body", () => {
    renderWithI18n(
      <StopPreviewConfirmDialog
        open={true}
        otherTabsCount={3}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    // body 文案含 "3"（与其他 3 个打开标签页 / "for 3 other open tabs"）
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it("calls onConfirm when Stop clicked", () => {
    const onConfirm = vi.fn();
    renderWithI18n(
      <StopPreviewConfirmDialog
        open={true}
        otherTabsCount={1}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /停止|stop/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("calls onCancel when Cancel clicked", () => {
    const onCancel = vi.fn();
    renderWithI18n(
      <StopPreviewConfirmDialog
        open={true}
        otherTabsCount={1}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /取消|cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
