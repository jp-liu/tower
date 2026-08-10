import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { GuidedTour } from "../guided-tour";

vi.mock("@/actions/config-actions", () => ({
  setConfigValue: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-tour]").forEach((element) => element.remove());
});

describe("GuidedTour", () => {
  it("uses primary theme tokens instead of legacy accent classes", async () => {
    for (const tourTarget of ["create-workspace", "create-project"]) {
      const target = document.createElement("button");
      target.dataset.tour = tourTarget;
      target.getBoundingClientRect = vi.fn(() => ({
        x: 20,
        y: 20,
        left: 20,
        top: 20,
        right: 60,
        bottom: 52,
        width: 40,
        height: 32,
        toJSON: () => ({}),
      } as DOMRect));
      document.body.appendChild(target);
    }

    const { container } = render(
      <I18nProvider>
        <GuidedTour onComplete={vi.fn()} />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/创建工作区|Create Workspace/i)).toBeInTheDocument();
    });

    const getClassTokens = () =>
      Array.from(container.querySelectorAll("[class]")).flatMap((element) =>
        (element.getAttribute("class") ?? "").split(/\s+/)
      );

    expect(getClassTokens()).toContain("ring-primary");

    const nextButton = screen.getByRole("button", { name: /下一步|Next/i });
    expect(nextButton).toHaveClass("bg-primary", "text-primary-foreground");

    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(getClassTokens()).toContain("bg-primary/40");
    });

    expect(getClassTokens()).toContain("bg-primary");
    expect(getClassTokens().some((token) => /amber|yellow|gold/.test(token))).toBe(false);
  });
});
