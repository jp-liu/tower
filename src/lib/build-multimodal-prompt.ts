import * as fs from "node:fs";
import * as path from "node:path";

const MAX_IMAGES = 10;

/** UUID v4 + allowed image extensions — prevents traversal and arbitrary filenames */
const SAFE_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$/i;

/**
 * Builds a multimodal prompt by appending image file paths to the prompt text.
 *
 * If no images are provided (or all resolve to missing files), returns the
 * original prompt unchanged — preserving backward compatibility for text-only
 * messages (AI-03).
 *
 * The appended section instructs Claude to use the Read tool to view the images,
 * so they become part of the conversation context (AI-01, AI-02).
 *
 * @param prompt - The original prompt text
 * @param imageFilenames - Array of filenames (not full paths) stored in cacheDir
 * @param cacheDir - Absolute path to the directory where images are stored
 * @returns The original prompt (if no valid images) or prompt with appended image section
 */
export function buildMultimodalPrompt(
  prompt: string,
  imageFilenames: string[],
  cacheDir: string
): string {
  if (imageFilenames.length === 0) {
    return prompt;
  }

  const filenames = imageFilenames.slice(0, MAX_IMAGES);
  const cacheDirNorm = path.resolve(cacheDir);

  // Validate filename format, resolve path, and enforce containment
  const validPaths = filenames
    .filter((filename) => SAFE_FILENAME_RE.test(filename))
    .map((filename) => path.resolve(cacheDir, filename))
    .filter((absPath) => {
      if (!absPath.startsWith(cacheDirNorm + path.sep)) return false;
      return fs.existsSync(absPath);
    });

  if (validPaths.length === 0) {
    return prompt;
  }

  const pathList = validPaths.map((p) => `- ${p}`).join("\n");

  return `${prompt}\n\n---\nThe user has attached the following image(s). Use the Read tool to view them:\n${pathList}`;
}
