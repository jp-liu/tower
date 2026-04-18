/**
 * Magic-byte MIME detection for image files.
 *
 * Validates file type by inspecting raw bytes — never trusts browser-supplied
 * Content-Type or file.type, which can be spoofed (e.g. SVG-as-PNG XSS).
 */

interface MimeSignature {
  mime: string;
  check: (b: Buffer) => boolean;
}

const SIGNATURES: MimeSignature[] = [
  {
    mime: "image/jpeg",
    check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/png",
    check: (b) =>
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47,
  },
  {
    mime: "image/gif",
    check: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  },
  {
    mime: "image/webp",
    // RIFF at bytes 0-3, WEBP at bytes 8-11
    check: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

/**
 * Detect image MIME type from buffer magic bytes.
 *
 * Returns null if:
 * - Buffer is shorter than 12 bytes (not enough to check WEBP signature)
 * - No known image signature matches
 */
export function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  for (const sig of SIGNATURES) {
    if (sig.check(buffer)) return sig.mime;
  }
  return null;
}

/** Maps detected MIME type to canonical file extension. */
export const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
