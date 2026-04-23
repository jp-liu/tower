import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/actions/onboarding-actions", () => ({
  setOnboardingProgress: vi.fn(() => Promise.resolve()),
  completeOnboarding: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/components/settings/cli-adapter-tester", () => ({
  CLIAdapterTester: ({
    onResult,
  }: {
    adapterType: string;
    adapterLabel?: string;
    onResult?: (result: { ok: boolean; checks: { name: string; passed: boolean; message: string }[] }) => void;
  }) => (
    <button
      data-testid="test-connection-btn"
      onClick={() => onResult?.({ ok: true, checks: [] })}
    >
      Test Connection
    </button>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "zh",
    setLocale: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Import components after mocks
// ---------------------------------------------------------------------------

import { WizardStepUsername } from "@/components/onboarding/wizard-step-username";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { WizardStepCli } from "@/components/onboarding/wizard-step-cli";

// ---------------------------------------------------------------------------
// ONBD-03: Username collection
// ---------------------------------------------------------------------------

describe("ONBD-03: Username collection", () => {
  it("disables Next when input is empty; enables after typing; calls onNext with trimmed username", async () => {
    const onNext = vi.fn();
    render(<WizardStepUsername onNext={onNext} />);

    // Find Next button — t() returns key as-is
    const nextBtn = screen.getByRole("button", { name: /onboarding\.step1\.next/i });
    expect(nextBtn).toBeDisabled();

    // Type a username
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "alice" } });

    expect(nextBtn).not.toBeDisabled();

    fireEvent.click(nextBtn);
    expect(onNext).toHaveBeenCalledWith("alice");
  });

  it("trims whitespace — does not enable Next for whitespace-only input", () => {
    const onNext = vi.fn();
    render(<WizardStepUsername onNext={onNext} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });

    const nextBtn = screen.getByRole("button", { name: /onboarding\.step1\.next/i });
    expect(nextBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// ONBD-06: Wizard renders non-dismissible overlay
// ---------------------------------------------------------------------------

describe("ONBD-06: Wizard renders non-dismissible overlay", () => {
  it("renders the wizard dialog open with title text visible", () => {
    render(<OnboardingWizard onComplete={vi.fn()} />);

    // Wizard title is present (t() returns key)
    expect(screen.getByText("onboarding.title")).toBeDefined();
  });

  it("does not render a close button inside the dialog", () => {
    render(<OnboardingWizard onComplete={vi.fn()} />);

    // No close button should appear
    const closeButton = screen.queryByRole("button", { name: /close/i });
    expect(closeButton).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ONBD-07: Complete button gated on CLI test
// ---------------------------------------------------------------------------

describe("ONBD-07: Complete button gated on CLI test", () => {
  it("disables Complete initially; enables after successful test result", async () => {
    render(<WizardStepCli username="testuser" onComplete={vi.fn()} />);

    const completeBtn = screen.getByRole("button", { name: /onboarding\.complete/i });
    expect(completeBtn).toBeDisabled();

    // Click the mocked Test Connection button to fire onResult({ ok: true })
    const testBtn = screen.getByTestId("test-connection-btn");
    fireEvent.click(testBtn);

    // Complete button should now be enabled
    expect(completeBtn).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// ONBD-09: CLI failure shows error
// ---------------------------------------------------------------------------

describe("ONBD-09: CLI failure shows error", () => {
  it("shows error text when CLI test fails", () => {
    // Override the CLIAdapterTester mock locally to fire ok: false
    vi.mocked(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@/components/settings/cli-adapter-tester").CLIAdapterTester
    ).mockImplementationOnce(
      ({
        onResult,
      }: {
        adapterType: string;
        adapterLabel?: string;
        onResult?: (result: { ok: boolean; checks: { name: string; passed: boolean; message: string }[] }) => void;
      }) => (
        <button
          data-testid="test-connection-btn-fail"
          onClick={() =>
            onResult?.({
              ok: false,
              checks: [{ name: "test", passed: false, message: "not found" }],
            })
          }
        >
          Test Connection
        </button>
      )
    );

    render(<WizardStepCli username="testuser" onComplete={vi.fn()} />);

    const testBtn = screen.getByTestId("test-connection-btn-fail");
    fireEvent.click(testBtn);

    // Error key should be shown (t() returns key as-is)
    expect(screen.getByText("onboarding.cliRequired")).toBeDefined();
  });
});
