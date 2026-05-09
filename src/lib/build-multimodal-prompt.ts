import * as fs from "node:fs";
import * as path from "node:path";
import {
  ATTACHMENT_SUBPATH_RE,
  MAX_ATTACHMENTS,
  classifyAttachmentSubPath,
} from "./attachment-utils";

/**
 * Builds a chat prompt enriched with attachment file paths.
 *
 * Behaviour:
 *   - Empty attachment list returns the prompt unchanged.
 *   - Each attachment sub-path (e.g. `2026-04/files/note-abc.md`) is validated
 *     against the central regex, resolved into the cache directory, and contained
 *     within it (path-traversal guard). Missing files are skipped.
 *   - The appended block tags each path with [Image] / [Text] so Claude knows
 *     whether it's looking at media or readable text and can pick the right tool.
 *
 * The MAX_ATTACHMENTS cap is enforced by truncating the input list — callers
 * already validate up-front, this is a final safety net.
 */
export function buildAttachmentPrompt(
  prompt: string,
  attachmentFilenames: string[],
  cacheDir: string
): string {
  if (attachmentFilenames.length === 0) {
    return prompt;
  }

  const filenames = attachmentFilenames.slice(0, MAX_ATTACHMENTS);
  const cacheDirNorm = path.resolve(cacheDir);

  type Entry = { kind: "image" | "text"; absPath: string };
  const valid: Entry[] = [];

  for (const subPath of filenames) {
    if (!ATTACHMENT_SUBPATH_RE.test(subPath)) continue;
    const kind = classifyAttachmentSubPath(subPath);
    if (!kind) continue;
    const absPath = path.resolve(cacheDir, subPath);
    if (!absPath.startsWith(cacheDirNorm + path.sep)) continue;
    if (!fs.existsSync(absPath)) continue;
    valid.push({ kind, absPath });
  }

  if (valid.length === 0) {
    return prompt;
  }

  const pathList = valid
    .map((e) => `- [${e.kind === "image" ? "Image" : "Text"}] ${e.absPath}`)
    .join("\n");

  return `${prompt}\n\n---\nThe user has attached the following file(s). Use the Read tool to view them:\n${pathList}`;
}
