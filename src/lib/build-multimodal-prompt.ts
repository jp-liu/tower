import * as fs from "node:fs";
import * as path from "node:path";

const MAX_IMAGES = 10;

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

  // Cap at MAX_IMAGES (10) — excess silently dropped
  const filenames = imageFilenames.slice(0, 10);

  // Resolve absolute paths and filter out files that don't exist on disk
  const validPaths = filenames
    .map((filename) => path.join(cacheDir, filename))
    .filter((absPath) => fs.existsSync(absPath));

  if (validPaths.length === 0) {
    return prompt;
  }

  const pathList = validPaths.map((p) => `- ${p}`).join("\n");

  return `${prompt}\n\n---\nThe user has attached the following image(s). Use the Read tool to view them:\n${pathList}`;
}
