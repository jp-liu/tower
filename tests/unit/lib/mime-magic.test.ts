// @vitest-environment node
import { describe, it, expect } from "vitest";
import { detectImageMime, MIME_TO_EXT } from "@/lib/mime-magic";

// Helper to build a buffer with specific bytes at given offsets
function makeBuffer(bytes: number[], total = 16): Buffer {
  const buf = Buffer.alloc(total, 0);
  for (let i = 0; i < bytes.length; i++) {
    buf[i] = bytes[i];
  }
  return buf;
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
// RIFF....WEBP — bytes 0-3 = RIFF, bytes 4-7 = size (any), bytes 8-11 = WEBP
const WEBP_MAGIC = [
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x00, 0x00, 0x00, 0x00, // size (ignored)
  0x57, 0x45, 0x42, 0x50, // WEBP
];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const SVG_TEXT = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\">");

describe("detectImageMime", () => {
  it("returns image/jpeg for JPEG magic bytes (FF D8 FF)", () => {
    const buf = makeBuffer(JPEG_MAGIC);
    expect(detectImageMime(buf)).toBe("image/jpeg");
  });

  it("returns image/png for PNG magic bytes (89 50 4E 47)", () => {
    const buf = makeBuffer(PNG_MAGIC);
    expect(detectImageMime(buf)).toBe("image/png");
  });

  it("returns image/gif for GIF magic bytes (47 49 46)", () => {
    const buf = makeBuffer(GIF_MAGIC);
    expect(detectImageMime(buf)).toBe("image/gif");
  });

  it("returns image/webp for WEBP magic bytes (RIFF....WEBP)", () => {
    const buf = makeBuffer(WEBP_MAGIC);
    expect(detectImageMime(buf)).toBe("image/webp");
  });

  it("returns null for PDF magic bytes (25 50 44 46)", () => {
    const buf = makeBuffer(PDF_MAGIC);
    expect(detectImageMime(buf)).toBeNull();
  });

  it("returns null for SVG (text-based, no image magic)", () => {
    // SVG is text, starts with '<svg', no magic byte match
    const buf = Buffer.alloc(16, 0);
    SVG_TEXT.copy(buf, 0, 0, 16);
    expect(detectImageMime(buf)).toBeNull();
  });

  it("returns null for empty buffer (length < 12)", () => {
    const buf = Buffer.alloc(0);
    expect(detectImageMime(buf)).toBeNull();
  });

  it("returns null for short buffer with length < 12", () => {
    const buf = Buffer.alloc(8, 0xff);
    expect(detectImageMime(buf)).toBeNull();
  });

  it("returns null for all-zero buffer", () => {
    const buf = Buffer.alloc(16, 0);
    expect(detectImageMime(buf)).toBeNull();
  });
});

describe("MIME_TO_EXT", () => {
  it("maps image/jpeg to .jpg", () => {
    expect(MIME_TO_EXT["image/jpeg"]).toBe(".jpg");
  });

  it("maps image/png to .png", () => {
    expect(MIME_TO_EXT["image/png"]).toBe(".png");
  });

  it("maps image/gif to .gif", () => {
    expect(MIME_TO_EXT["image/gif"]).toBe(".gif");
  });

  it("maps image/webp to .webp", () => {
    expect(MIME_TO_EXT["image/webp"]).toBe(".webp");
  });

  it("contains exactly 4 entries", () => {
    expect(Object.keys(MIME_TO_EXT)).toHaveLength(4);
  });
});
