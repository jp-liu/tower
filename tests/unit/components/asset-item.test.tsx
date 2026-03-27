import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { AssetItem } from "@/components/assets/asset-item";
import type { AssetItemType } from "@/components/assets/asset-item";

vi.mock("@/lib/file-serve", () => ({
  localPathToApiUrl: (p: string) => `/api/files/${p}`,
}));

afterEach(() => {
  cleanup();
});

const mockAsset: AssetItemType = {
  id: "asset-1",
  filename: "photo.png",
  path: "data/assets/proj-1/photo.png",
  mimeType: "image/png",
  size: 1024,
  createdAt: new Date("2026-03-01"),
};

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("AssetItem", () => {
  it("renders filename text", () => {
    renderWithI18n(<AssetItem asset={mockAsset} onDelete={vi.fn()} />);
    expect(screen.getByText("photo.png")).toBeInTheDocument();
  });

  it("renders formatted file size in KB", () => {
    renderWithI18n(<AssetItem asset={mockAsset} onDelete={vi.fn()} />);
    // 1024 bytes = 1.0 KB
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
  });

  it("renders image thumbnail when mimeType starts with image/", () => {
    renderWithI18n(<AssetItem asset={mockAsset} onDelete={vi.fn()} />);
    const img = screen.getByRole("img", { name: "photo.png" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("alt", "photo.png");
  });

  it("renders file icon when mimeType is not an image", () => {
    const pdfAsset: AssetItemType = {
      ...mockAsset,
      filename: "report.pdf",
      mimeType: "application/pdf",
    };
    renderWithI18n(<AssetItem asset={pdfAsset} onDelete={vi.fn()} />);
    expect(screen.queryByRole("img", { name: "report.pdf" })).not.toBeInTheDocument();
    // The FileText svg icon should be present (no img tag for non-image)
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("renders download link with correct href and download attribute", () => {
    renderWithI18n(<AssetItem asset={mockAsset} onDelete={vi.fn()} />);
    const downloadLink = screen.getByRole("link", { name: "下载" });
    expect(downloadLink).toHaveAttribute("href", "/api/files/data/assets/proj-1/photo.png");
    expect(downloadLink).toHaveAttribute("download", "photo.png");
  });

  it("calls onDelete when delete button is clicked", () => {
    const onDelete = vi.fn();
    renderWithI18n(<AssetItem asset={mockAsset} onDelete={onDelete} />);
    const deleteButton = screen.getByRole("button", { name: "删除" });
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith("asset-1");
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
