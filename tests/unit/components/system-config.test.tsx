// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SystemConfig } from "@/components/settings/system-config";

// Mock server actions (they cannot run in jsdom)
vi.mock("@/actions/config-actions", () => ({
  getConfigValue: vi.fn().mockResolvedValue([]),
  getConfigValues: vi.fn().mockResolvedValue({}),
  setConfigValue: vi.fn().mockResolvedValue(undefined),
}));

// Mock i18n to return key as text
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

afterEach(() => {
  cleanup();
});

describe("SystemConfig", () => {
  it("renders without crashing", () => {
    render(<SystemConfig />);
    expect(screen.getByText("settings.config")).toBeTruthy();
  });

  it("shows git rules section heading", () => {
    render(<SystemConfig />);
    expect(screen.getByText("settings.config.git.title")).toBeTruthy();
  });
});
