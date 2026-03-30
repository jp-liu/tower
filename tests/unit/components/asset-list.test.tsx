import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { AssetList } from "@/components/assets/asset-list";

vi.mock("@/lib/file-serve", () => ({
  localPathToApiUrl: (p: string) => `/api/files/${p}`,
}));

afterEach(() => {
  cleanup();
});

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const makeAsset = (id: string, filename: string) => ({
  id,
  filename,
  path: `data/assets/proj-1/${filename}`,
  mimeType: "text/plain",
  size: 512,
  description: null,
  createdAt: new Date("2026-03-01"),
});

describe("AssetList", () => {
  it("renders empty state text when assets array is empty", () => {
    renderWithI18n(<AssetList assets={[]} onDelete={vi.fn()} />);
    expect(screen.getByText("暂无资源")).toBeInTheDocument();
  });

  it("renders empty state hint text when assets array is empty", () => {
    renderWithI18n(<AssetList assets={[]} onDelete={vi.fn()} />);
    expect(screen.getByText("上传文件作为项目资源")).toBeInTheDocument();
  });

  it("renders multiple asset items when assets array has entries", () => {
    const assets = [makeAsset("a1", "file-one.txt"), makeAsset("a2", "file-two.txt")];
    renderWithI18n(<AssetList assets={assets} onDelete={vi.fn()} />);
    expect(screen.getByText("file-one.txt")).toBeInTheDocument();
    expect(screen.getByText("file-two.txt")).toBeInTheDocument();
  });

  it("does not render empty state when assets are present", () => {
    const assets = [makeAsset("a1", "file-one.txt")];
    renderWithI18n(<AssetList assets={assets} onDelete={vi.fn()} />);
    expect(screen.queryByText("暂无资源")).not.toBeInTheDocument();
  });
});
