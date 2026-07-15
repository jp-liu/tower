import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { listExtensions } from "@/lib/extensions/registry";
import { WizardStepExtensions } from "../wizard-step-extensions";

// Counted from the registry rather than hardcoded: "all" is what these tests
// actually mean, and a literal here silently goes stale the next time an
// extension is added — which is exactly how it broke last time.
const EXTENSION_COUNT = listExtensions().length;

vi.mock("@/actions/extension-actions", () => ({
  installExtension: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/actions/onboarding-actions", () => ({
  setOnboardingExtensions: vi.fn().mockResolvedValue(undefined),
  completeOnboarding: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function renderStep(onComplete = vi.fn()) {
  return render(
    <I18nProvider>
      <WizardStepExtensions username="tester" onComplete={onComplete} />
    </I18nProvider>
  );
}

describe("WizardStepExtensions", () => {
  it("renders one row per registered extension", async () => {
    renderStep();
    await waitFor(() => {
      // Both real extension descriptions appear
      const rgNodes = screen.queryAllByText(/代码搜索|ripgrep/i);
      const monacoNodes = screen.queryAllByText(/代码编辑器|Monaco/i);
      expect(rgNodes.length).toBeGreaterThanOrEqual(1);
      expect(monacoNodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("starts with all checkboxes checked by default", () => {
    renderStep();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(EXTENSION_COUNT);
    for (const cb of checkboxes) {
      expect(cb).toBeChecked();
    }
  });

  it("unchecking shows the skip hint", async () => {
    const user = userEvent.setup();
    renderStep();
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    expect(screen.getByText(/设置 → Extensions|Settings → Extensions/i)).toBeInTheDocument();
  });

  it("clicking 完成 with all checked installs all in parallel and completes", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    const actions = await import("@/actions/extension-actions");
    const onboarding = await import("@/actions/onboarding-actions");

    renderStep(onComplete);
    const finishBtn = screen.getByRole("button", { name: /完成|Finish/i });
    await user.click(finishBtn);

    await waitFor(() => {
      expect(actions.installExtension).toHaveBeenCalledTimes(EXTENSION_COUNT);
      expect(onboarding.setOnboardingExtensions).toHaveBeenCalledWith(
        expect.arrayContaining(["rg", "monaco"]),
        expect.arrayContaining(["rg", "monaco"])
      );
      expect(onboarding.completeOnboarding).toHaveBeenCalledWith("tester");
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("clicking 跳过并完成 with none checked installs nothing and completes", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    const actions = await import("@/actions/extension-actions");
    const onboarding = await import("@/actions/onboarding-actions");

    renderStep(onComplete);
    // Uncheck all
    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      await user.click(cb);
    }
    const finishBtn = screen.getByRole("button", { name: /跳过|Skip/i });
    await user.click(finishBtn);

    await waitFor(() => {
      expect(actions.installExtension).not.toHaveBeenCalled();
      expect(onboarding.setOnboardingExtensions).toHaveBeenCalledWith([], []);
      expect(onboarding.completeOnboarding).toHaveBeenCalledWith("tester");
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
