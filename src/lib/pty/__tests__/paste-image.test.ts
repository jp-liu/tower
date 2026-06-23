import { describe, it, expect } from "vitest";
import { imageExtForMime, formatPathForInjection } from "../paste-image";

describe("imageExtForMime", () => {
  it("maps known image MIME types to extensions", () => {
    expect(imageExtForMime("image/png")).toBe(".png");
    expect(imageExtForMime("image/jpeg")).toBe(".jpg");
    expect(imageExtForMime("image/gif")).toBe(".gif");
    expect(imageExtForMime("image/webp")).toBe(".webp");
    expect(imageExtForMime("image/svg+xml")).toBe(".svg");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(imageExtForMime("IMAGE/PNG")).toBe(".png");
    expect(imageExtForMime("  image/jpeg  ")).toBe(".jpg");
  });

  it("returns null for unsupported types", () => {
    expect(imageExtForMime("application/pdf")).toBeNull();
    expect(imageExtForMime("text/plain")).toBeNull();
    expect(imageExtForMime("")).toBeNull();
  });
});

describe("formatPathForInjection", () => {
  it("appends a trailing space and no CR for a simple path", () => {
    expect(formatPathForInjection("/tmp/tower/img.png")).toBe("/tmp/tower/img.png ");
  });

  it("quotes paths containing whitespace (Windows user profile dirs)", () => {
    expect(formatPathForInjection("C:\\Users\\First Last\\img.png")).toBe(
      '"C:\\Users\\First Last\\img.png" '
    );
  });

  it("never appends a carriage return (must not submit the prompt)", () => {
    expect(formatPathForInjection("/a/b.png")).not.toContain("\r");
    expect(formatPathForInjection("/a b/c.png")).not.toContain("\r");
  });
});
