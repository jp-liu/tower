import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { ImageLightbox } from "@/components/assets/image-lightbox";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ImageLightbox", () => {
  it("uses natural dimensions while preserving zoom, drag, and backdrop close events", async () => {
    const onOpenChange = vi.fn();
    render(
      <I18nProvider>
        <ImageLightbox
          imageUrl="/api/files/assets/project/wide.png"
          filename="wide.png"
          open
          onOpenChange={onOpenChange}
        />
      </I18nProvider>,
    );

    const image = screen.getByRole("img", { name: "wide.png" });
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1600 },
      naturalHeight: { configurable: true, value: 900 },
    });
    fireEvent.load(image);

    await waitFor(() => {
      expect(image).toHaveAttribute("width", "1600");
      expect(image).toHaveAttribute("height", "900");
    });
    expect(image).toHaveClass("max-w-[92vw]", "max-h-[88vh]");

    const stage = screen.getByTestId("image-lightbox-stage");
    fireEvent.wheel(stage, { deltaY: -100 });
    expect(image.style.transform).toContain("scale(1.25)");

    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(image, { pointerId: 1, clientX: 30, clientY: 25 });
    expect(image.style.transform).toContain("translate3d(20px, 15px, 0)");
    fireEvent.pointerUp(image, { pointerId: 1 });

    fireEvent.click(image);
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(stage);
    expect(onOpenChange).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
