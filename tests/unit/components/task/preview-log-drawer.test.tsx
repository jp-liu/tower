import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreviewLogDrawer } from "@/components/task/preview-log-drawer";
import { I18nProvider } from "@/lib/i18n";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("PreviewLogDrawer", () => {
  it("renders collapsed state by default with latest log line", () => {
    renderWithI18n(
      <PreviewLogDrawer
        expanded={false}
        latestLogLine="ready in 12 ms"
        onToggle={vi.fn()}
        showInstallBanner={false}
        onInstallNow={vi.fn()}
        onRunAnyway={vi.fn()}
      />
    );
    expect(screen.getByText(/ready in 12 ms/)).toBeInTheDocument();
  });

  it("strips ANSI from latest log line in collapsed view", () => {
    renderWithI18n(
      <PreviewLogDrawer
        expanded={false}
        latestLogLine="\x1b[31mred\x1b[0m text"
        onToggle={vi.fn()}
        showInstallBanner={false}
        onInstallNow={vi.fn()}
        onRunAnyway={vi.fn()}
      />
    );
    // 渲染后应该是 "red text"，没有 ANSI escape 字符
    // 由于文本可能被多个元素分割，使用 textContent 检查
    const button = screen.getByRole("button", { name: /日志|logs/i });
    expect(button.textContent).toContain("red");
    expect(button.textContent).toContain("text");
    expect(button.textContent).not.toContain("\x1b");
  });

  it("shows install banner when showInstallBanner is true", () => {
    renderWithI18n(
      <PreviewLogDrawer
        expanded={false}
        latestLogLine=""
        onToggle={vi.fn()}
        showInstallBanner={true}
        onInstallNow={vi.fn()}
        onRunAnyway={vi.fn()}
      />
    );
    // 安装提示按钮（i18n: preview.installNow = "立即安装" or "Install now"）
    expect(screen.getByRole("button", { name: /立即安装|install now/i })).toBeInTheDocument();
  });

  it("calls onInstallNow when [Install now] clicked", () => {
    const fn = vi.fn();
    renderWithI18n(
      <PreviewLogDrawer
        expanded={false}
        latestLogLine=""
        onToggle={vi.fn()}
        showInstallBanner={true}
        onInstallNow={fn}
        onRunAnyway={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /立即安装|install now/i }));
    expect(fn).toHaveBeenCalled();
  });

  it("calls onToggle when toggle button clicked", () => {
    const fn = vi.fn();
    renderWithI18n(
      <PreviewLogDrawer
        expanded={false}
        latestLogLine="some log"
        onToggle={fn}
        showInstallBanner={false}
        onInstallNow={vi.fn()}
        onRunAnyway={vi.fn()}
      />
    );
    // 折叠态的整个 header 是 button，role=button 但 name 含 "日志/Logs"
    const toggle = screen.getByRole("button", { name: /日志|logs/i });
    fireEvent.click(toggle);
    expect(fn).toHaveBeenCalled();
  });
});
