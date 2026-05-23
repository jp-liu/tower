import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { VersionTypeBadge, VersionStatusBadge } from "@/components/version/version-badges";

describe("version badges", () => {
  it("renders type label", () => {
    render(<I18nProvider><VersionTypeBadge name="bug修复" /></I18nProvider>);
    expect(screen.getByText("bug修复")).toBeInTheDocument();
  });
  it("renders status label", () => {
    render(<I18nProvider><VersionStatusBadge status="RELEASED" /></I18nProvider>);
    expect(screen.getByText(/已发布|released/i)).toBeInTheDocument();
  });
});
