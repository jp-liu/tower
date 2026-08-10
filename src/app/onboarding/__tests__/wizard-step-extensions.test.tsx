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
  completeOnboarding: vi.fn().mockResolvedValue({ workspaceId: "workspace-1" }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
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

  it("starts with all extensions unchecked by default", () => {
    renderStep();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(EXTENSION_COUNT);
    for (const cb of checkboxes) {
      expect(cb).not.toBeChecked();
    }
  });

  it("shows the skip hint before the user selects an extension", () => {
    renderStep();
    expect(screen.getByText(/设置 → Extensions|Settings → Extensions/i)).toBeInTheDocument();
  });

  it("installs every extension when the user explicitly selects all", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    const actions = await import("@/actions/extension-actions");
    const onboarding = await import("@/actions/onboarding-actions");

    renderStep(onComplete);
    for (const checkbox of screen.getAllByRole("checkbox")) {
      await user.click(checkbox);
    }
    const finishBtn = screen.getByRole("button", { name: /完成|Finish/i });
    await user.click(finishBtn);

    await waitFor(() => {
      expect(actions.installExtension).toHaveBeenCalledTimes(EXTENSION_COUNT);
      expect(onboarding.setOnboardingExtensions).toHaveBeenCalledWith(
        expect.arrayContaining(["rg", "monaco"]),
        expect.arrayContaining(["rg", "monaco"])
      );
      expect(onboarding.completeOnboarding).toHaveBeenCalledWith("tester");
      expect(onComplete).toHaveBeenCalledWith("workspace-1");
    });
  });

  it("skips installation and enters the app when nothing is selected", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    const actions = await import("@/actions/extension-actions");
    const onboarding = await import("@/actions/onboarding-actions");

    renderStep(onComplete);
    const finishBtn = screen.getByRole("button", { name: /跳过|Skip/i });
    await user.click(finishBtn);

    await waitFor(() => {
      expect(actions.installExtension).not.toHaveBeenCalled();
      expect(onboarding.setOnboardingExtensions).toHaveBeenCalledWith([], []);
      expect(onboarding.completeOnboarding).toHaveBeenCalledWith("tester");
      expect(onComplete).toHaveBeenCalledWith("workspace-1");
    });
  });

  it("passes null to the page callback when onboarding completes without a workspace", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    const onboarding = await import("@/actions/onboarding-actions");
    vi.mocked(onboarding.completeOnboarding).mockResolvedValueOnce({ workspaceId: null });

    renderStep(onComplete);
    await user.click(screen.getByRole("button", { name: /跳过|Skip/i }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(null);
    });
  });

  it("restores the finish action after persistence fails so the user can retry", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    const onboarding = await import("@/actions/onboarding-actions");
    const { toast } = await import("sonner");
    vi.mocked(onboarding.setOnboardingExtensions).mockRejectedValueOnce(new Error("Save failed"));

    renderStep(onComplete);
    const finishButton = screen.getByRole("button", { name: /跳过|Skip/i });
    await user.click(finishButton);

    await waitFor(() => {
      expect(finishButton).toBeEnabled();
      expect(toast.error).toHaveBeenCalledWith("Save failed");
      expect(onComplete).not.toHaveBeenCalled();
    });

    await user.click(finishButton);
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("workspace-1");
    });
  });
});
