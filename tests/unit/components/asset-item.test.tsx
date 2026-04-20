import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { AssetItem } from "@/components/assets/asset-item";
import type { AssetItemType } from "@/components/assets/asset-item";

vi.mock("@/lib/file-serve-client", () => ({
  localPathToApiUrl: (p: string) => {
    const m = p.match(/data\/assets\/([^/]+)\/([^/]+)$/);
    return m ? `/api/files/assets/${m[1]}/${m[2]}` : p;
  },
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
  description: null,
  createdAt: new Date("2026-03-01"),
};

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const defaultProps = {
  onPreview: vi.fn(),
  onReveal: vi.fn(),
  onDelete: vi.fn(),
};

describe("AssetItem", () => {
  it("renders filename text", () => {
    renderWithI18n(<AssetItem asset={mockAsset} {...defaultProps} />);
    expect(screen.getByText("photo.png")).toBeInTheDocument();
  });

  it("renders formatted file size in KB", () => {
    renderWithI18n(<AssetItem asset={mockAsset} {...defaultProps} />);
    // 1024 bytes = 1.0 KB
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
  });

  it("renders image thumbnail when mimeType starts with image/", () => {
    renderWithI18n(<AssetItem asset={mockAsset} {...defaultProps} />);
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
    renderWithI18n(<AssetItem asset={pdfAsset} {...defaultProps} />);
    expect(screen.queryByRole("img", { name: "report.pdf" })).not.toBeInTheDocument();
    // The FileText svg icon should be present (no img tag for non-image)
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("renders preview, reveal, and delete action buttons", () => {
    renderWithI18n(<AssetItem asset={mockAsset} {...defaultProps} />);
    // Preview button (Eye icon) with i18n label "预览"
    expect(screen.getByRole("button", { name: "预览" })).toBeInTheDocument();
    // Reveal in Finder button with i18n label "在文件夹中显示"
    expect(screen.getByRole("button", { name: "在文件夹中显示" })).toBeInTheDocument();
    // Delete button
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("calls onPreview when preview button is clicked", () => {
    const onPreview = vi.fn();
    renderWithI18n(<AssetItem asset={mockAsset} {...defaultProps} onPreview={onPreview} />);
    const previewButton = screen.getByRole("button", { name: "预览" });
    fireEvent.click(previewButton);
    expect(onPreview).toHaveBeenCalledWith(mockAsset);
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("calls onReveal when reveal button is clicked", () => {
    const onReveal = vi.fn();
    renderWithI18n(<AssetItem asset={mockAsset} {...defaultProps} onReveal={onReveal} />);
    const revealButton = screen.getByRole("button", { name: "在文件夹中显示" });
    fireEvent.click(revealButton);
    expect(onReveal).toHaveBeenCalledWith(mockAsset);
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it("calls onDelete when delete button is clicked", () => {
    const onDelete = vi.fn();
    renderWithI18n(<AssetItem asset={mockAsset} {...defaultProps} onDelete={onDelete} />);
    const deleteButton = screen.getByRole("button", { name: "删除" });
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith("asset-1");
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
