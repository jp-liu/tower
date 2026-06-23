/**
 * paste-image.ts — Pure helpers shared by the terminal image-paste route and the
 * xterm.js frontend.
 *
 * Background: Tower's task terminal is browser-side xterm.js, not a native OS
 * terminal. xterm's default paste handler forwards clipboard *text* only — image
 * blobs are dropped, and the Ctrl+V keystroke never reaches the Claude CLI as a
 * raw byte, so the CLI's own clipboard-image reader never fires. To support image
 * paste we intercept the browser paste event, persist the image to a host file,
 * then inject that file's absolute path as terminal input. Claude CLI detects a
 * local image path in the prompt and reads it.
 *
 * These helpers are intentionally free of Node/DOM globals so both the API route
 * (Node) and the React component (browser) can import them.
 */

/** Image MIME types we accept for terminal paste, mapped to a file extension. */
const IMAGE_MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/avif": ".avif",
  "image/x-icon": ".ico",
  "image/svg+xml": ".svg",
};

/**
 * Resolve a file extension (with leading dot) for a pasted image MIME type.
 * Returns null for unsupported types so callers can reject rather than guess.
 */
export function imageExtForMime(mime: string): string | null {
  return IMAGE_MIME_EXT[mime.trim().toLowerCase()] ?? null;
}

/**
 * Format an absolute file path for injection into the terminal as prompt text.
 *
 * - Wraps the path in double quotes when it contains whitespace (Windows temp
 *   paths often live under "C:\Users\First Last\...") so the CLI's path detector
 *   treats it as a single token.
 * - Appends a trailing space so the user can keep typing after the inserted path.
 *
 * Note: a CR is never appended — injection must NOT submit the prompt.
 */
export function formatPathForInjection(filePath: string): string {
  const needsQuotes = /\s/.test(filePath);
  return needsQuotes ? `"${filePath}" ` : `${filePath} `;
}
