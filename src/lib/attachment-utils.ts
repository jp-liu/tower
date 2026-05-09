/**
 * Centralised allowlist for assistant chat attachments.
 *
 * Two kinds are supported:
 *   - image — viewable thumbnails, validated via magic-byte detection
 *   - text  — readable files (md/txt/json/csv), validated via extension + null-byte sniff
 *
 * Doc/spreadsheet formats (.docx/.xlsx/.doc/.xls) are intentionally NOT supported here:
 * Claude's Read tool cannot decode them without server-side extraction (planned for a
 * future iteration). When that lands, add the new exts here and update the route, regex,
 * prompt builder, and frontend allowlist together.
 */

export const ALLOWED_IMAGE_EXTS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
] as const;

export const ALLOWED_TEXT_EXTS = ["md", "txt", "json", "csv"] as const;

export type AllowedImageExt = typeof ALLOWED_IMAGE_EXTS[number];
export type AllowedTextExt = typeof ALLOWED_TEXT_EXTS[number];
export type AllowedExt = AllowedImageExt | AllowedTextExt;

/** Combined regex source — keep in sync with the constants above. */
const ALL_EXTS = [...ALLOWED_IMAGE_EXTS, ...ALLOWED_TEXT_EXTS].join("|");

/** Sub-path layout: `YYYY-MM/(images|files)/<filename>.<ext>` */
export const ATTACHMENT_SUBPATH_RE = new RegExp(
  `^\\d{4}-\\d{2}/(images|files)/[^/]+\\.(${ALL_EXTS})$`,
  "i"
);

/** Maximum number of attachments allowed per chat message (images + texts combined). */
export const MAX_ATTACHMENTS = 10;

export type AttachmentKind = "image" | "text";

/** Decide which kind a file is purely from its name/extension. */
export function classifyAttachmentExt(ext: string): AttachmentKind | null {
  const lowered = ext.replace(/^\./, "").toLowerCase();
  if ((ALLOWED_IMAGE_EXTS as readonly string[]).includes(lowered)) return "image";
  if ((ALLOWED_TEXT_EXTS as readonly string[]).includes(lowered)) return "text";
  return null;
}

/** Read kind from a stored sub-path (e.g. `2026-04/files/note-abc12345.md`). */
export function classifyAttachmentSubPath(subPath: string): AttachmentKind | null {
  if (!ATTACHMENT_SUBPATH_RE.test(subPath)) return null;
  const dotIdx = subPath.lastIndexOf(".");
  if (dotIdx < 0) return null;
  return classifyAttachmentExt(subPath.slice(dotIdx + 1));
}

/** Browser-side `accept` string for `<input type="file">` */
export const ATTACHMENT_ACCEPT_ATTR = [
  ...ALLOWED_IMAGE_EXTS.map((e) => `.${e}`),
  ...ALLOWED_TEXT_EXTS.map((e) => `.${e}`),
  "image/*",
].join(",");
