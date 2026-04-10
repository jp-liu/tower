import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import type { TestResult } from "@/lib/cli-test";
// Component to be created in Plan 02
import { CLIAdapterTester } from "@/components/settings/cli-adapter-tester";

// --- Mock data ---

const mockPassingResult: TestResult = {
  ok: true,
  checks: [
    { name: "claude_command_resolvable", passed: true, message: "claude command found in PATH" },
    { name: "claude_version", passed: true, message: "Version: 1.0.17" },
    { name: "anthropic_api_key", passed: true, message: "ANTHROPIC_API_KEY is set" },
    { name: "claude_hello_probe", passed: true, message: "Claude hello probe succeeded" },
  ],
};

const mockFailingResult: TestResult = {
  ok: false,
  checks: [
    { name: "claude_command_resolvable", passed: false, message: 'Command not found in PATH: "claude"' },
  ],
};

// --- Helpers ---

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

// --- Setup / Teardown ---

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockPassingResult,
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// --- Tests ---

describe("CLIAdapterTester", () => {
  it("renders Test Connection button for adapter", () => {
    renderWithI18n(<CLIAdapterTester adapterType="claude_local" />);
    // zh locale — button text from t("settings.aiTools.testConnection")
    expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
  });

  it("clicking Test Connection triggers fetch to /api/adapters/test with POST and correct body", async () => {
    renderWithI18n(<CLIAdapterTester adapterType="claude_local" />);
    const button = screen.getByRole("button", { name: "测试连接" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/adapters/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adapterType: "claude_local" }),
      });
    });
  });

  it("button shows testing text and is disabled while fetch is in progress", async () => {
    // Keep fetch pending so loading state is stable
    let resolvePromise!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolvePromise = resolve;
        }),
      ),
    );

    renderWithI18n(<CLIAdapterTester adapterType="claude_local" />);
    const button = screen.getByRole("button", { name: "测试连接" });
    fireEvent.click(button);

    // While pending, button should be disabled and show loading text
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "测试中..." })).toBeDisabled();
    });

    // Resolve to clean up
    resolvePromise({
      ok: true,
      json: async () => mockPassingResult,
    } as Response);
  });

  it("after successful fetch, renders each TestCheck row with pass/fail icons", async () => {
    renderWithI18n(<CLIAdapterTester adapterType="claude_local" />);
    const button = screen.getByRole("button", { name: "测试连接" });
    fireEvent.click(button);

    await waitFor(() => {
      // All 4 checks should appear by their message text
      expect(screen.getByText("claude command found in PATH")).toBeInTheDocument();
      expect(screen.getByText("Version: 1.0.17")).toBeInTheDocument();
      expect(screen.getByText("ANTHROPIC_API_KEY is set")).toBeInTheDocument();
      expect(screen.getByText("Claude hello probe succeeded")).toBeInTheDocument();
    });
  });

  it("version check row displays version string from check message", async () => {
    renderWithI18n(<CLIAdapterTester adapterType="claude_local" />);
    const button = screen.getByRole("button", { name: "测试连接" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Version: 1.0.17")).toBeInTheDocument();
    });
  });

  it("when no test has been run, no result card is shown", () => {
    renderWithI18n(<CLIAdapterTester adapterType="claude_local" />);
    // Only the button should be present; no check messages yet
    expect(screen.queryByText("claude command found in PATH")).not.toBeInTheDocument();
    expect(screen.queryByText("Version: 1.0.17")).not.toBeInTheDocument();
  });

  it("clicking button while already testing has no effect (button is disabled)", async () => {
    let resolvePromise!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolvePromise = resolve;
        }),
      ),
    );

    renderWithI18n(<CLIAdapterTester adapterType="claude_local" />);
    const button = screen.getByRole("button", { name: "测试连接" });
    fireEvent.click(button);

    await waitFor(() => {
      const loadingButton = screen.getByRole("button", { name: "测试中..." });
      expect(loadingButton).toBeDisabled();
      // Clicking disabled button should not fire additional fetch calls
      fireEvent.click(loadingButton);
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolvePromise({
      ok: true,
      json: async () => mockPassingResult,
    } as Response);
  });
});
