"use client";

import { AlertCircle, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { PendingAttachment } from "@/hooks/use-attachment-upload";

interface StripProps {
  pendingAttachments: PendingAttachment[];
  onRemove: (id: string) => void;
  onPreview: (attachment: PendingAttachment) => void;
}

/**
 * Visual width of a string. CJK characters render about 2x as wide as ASCII,
 * so a fixed-px container can display far fewer of them. We count fullwidth
 * codepoints as 2 width units so middle-truncation budgets the right amount
 * of space and the inline ellipsis lands at the right spot.
 */
function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    // CJK + Hiragana/Katakana + Hangul + Fullwidth forms — these are wide
    if (
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xff00 && code <= 0xffef) ||
      code >= 0x20000
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** Take chars from the start until reaching a width budget. */
function takeStart(s: string, budget: number): string {
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = visualWidth(ch);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return out;
}

/** Take chars from the end until reaching a width budget. */
function takeEnd(s: string, budget: number): string {
  const chars = Array.from(s);
  let w = 0;
  let out = "";
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = visualWidth(chars[i]);
    if (w + cw > budget) break;
    out = chars[i] + out;
    w += cw;
  }
  return out;
}

/**
 * Truncate a filename in the middle, budgeted by *visual width* so CJK names
 * actually fit inside a fixed-px container. Preserves the file extension.
 *
 * @param name original filename
 * @param maxWidth visual-width budget (ASCII char = 1, CJK = 2)
 */
function middleTruncate(name: string, maxWidth = 22): string {
  if (visualWidth(name) <= maxWidth) return name;
  const dotIdx = name.lastIndexOf(".");
  const hasExt = dotIdx > 0 && name.length - dotIdx <= 8;
  const ext = hasExt ? name.slice(dotIdx) : "";
  const stem = hasExt ? name.slice(0, dotIdx) : name;
  const room = maxWidth - visualWidth(ext) - 1; // 1 width unit for "…"
  if (room < 4) {
    return takeStart(name, maxWidth - 1) + "…";
  }
  const headBudget = Math.ceil(room / 2);
  const tailBudget = room - headBudget;
  return takeStart(stem, headBudget) + "…" + takeEnd(stem, tailBudget) + ext;
}

/**
 * Images strip — own row, small thumbnails.
 */
export function ImageStrip({ pendingAttachments, onRemove, onPreview }: StripProps) {
  const { t } = useI18n();
  const images = pendingAttachments.filter((a) => a.kind === "image");
  if (images.length === 0) return null;

  return (
    <div className="flex flex-row flex-wrap items-center gap-2 px-3 py-2 border-b border-border/60">
      {images.map((item) => (
        <ImageTile
          key={item.id}
          item={item}
          onRemove={onRemove}
          onPreview={onPreview}
          t={t}
        />
      ))}
    </div>
  );
}

/**
 * Files strip — own row, fixed-width compact pills.
 */
export function FileStrip({
  pendingAttachments,
  onRemove,
  onPreview,
}: StripProps) {
  const { t } = useI18n();
  const files = pendingAttachments.filter((a) => a.kind === "text");
  if (files.length === 0) return null;

  return (
    <div className="flex flex-row flex-wrap items-center gap-2 px-3 py-2 border-b border-border/60">
      {files.map((item) => (
        <FileTile key={item.id} item={item} onRemove={onRemove} onPreview={onPreview} t={t} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

interface TileProps {
  item: PendingAttachment;
  onRemove: (id: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}

function ImageTile({
  item,
  onRemove,
  onPreview,
  t,
}: TileProps & { onPreview: (a: PendingAttachment) => void }) {
  // Outer wrapper does NOT clip — lets the floating × button escape the corner.
  // Inner box owns the rounded clipping for the image content.
  return (
    <div className="group relative h-9 w-9 shrink-0">
      <div
        className={`relative h-full w-full overflow-hidden rounded-md border ${
          item.status === "error" ? "border-destructive" : "border-border"
        } bg-muted`}
      >
        <button
          type="button"
          className={`h-full w-full p-0 border-0 bg-transparent ${
            item.status === "uploading" ? "cursor-wait" : "cursor-pointer"
          }`}
          disabled={item.status === "uploading"}
          aria-label={t("assistant.previewImage")}
          onClick={() => onPreview(item)}
        >
          {item.blobUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.blobUrl} className="h-full w-full object-cover" alt="" />
          )}
        </button>

        {item.status === "uploading" && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/20">
            <div
              role="progressbar"
              aria-valuenow={item.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-full bg-primary transition-all duration-150"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}

        {item.status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <AlertCircle className="h-3.5 w-3.5 text-white" />
          </div>
        )}
      </div>

      <FloatingRemove item={item} onRemove={onRemove} t={t} />
    </div>
  );
}

/**
 * File pill: `[×] | filename.md` — fixed width, middle-truncated text, no
 * file-type icon (felt visually heavy in chat). The × on the left doubles as
 * the remove control; the vertical divider gives a small visual seam.
 */
function FileTile({
  item,
  onRemove,
  onPreview,
  t,
}: TileProps & { onPreview: (a: PendingAttachment) => void }) {
  const display = middleTruncate(item.file.name, 22);
  // Preview only once uploaded — TextPreviewDialog fetches the server url.
  const canPreview = item.status === "done";

  return (
    <div
      className={`group relative flex items-center h-7 w-[200px] shrink-0 rounded-md border bg-background overflow-hidden transition-colors ${
        item.status === "error" ? "border-destructive" : "border-border hover:bg-accent/40"
      }`}
      title={item.file.name}
    >
      <button
        type="button"
        className="flex h-full w-7 shrink-0 items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        aria-label={t("assistant.removeAttachment")}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(item.id);
        }}
      >
        <X className="h-3 w-3" />
      </button>
      <div className="h-4 w-px bg-border shrink-0" />
      <button
        type="button"
        disabled={!canPreview}
        onClick={() => canPreview && onPreview(item)}
        className="min-w-0 flex-1 px-2 text-left text-xs text-foreground tabular-nums truncate enabled:cursor-pointer enabled:hover:text-primary"
        title={item.file.name}
      >
        {display}
      </button>

      {item.status === "uploading" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
          <div
            role="progressbar"
            aria-valuenow={item.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-full bg-primary transition-all duration-150"
            style={{ width: `${item.progress}%` }}
          />
        </div>
      )}

      {item.status === "error" && (
        <AlertCircle className="ml-auto mr-2 h-3 w-3 shrink-0 text-destructive" />
      )}
    </div>
  );
}

/**
 * Floating × used by image tiles only. File tiles have their × inline.
 */
function FloatingRemove({ item, onRemove, t }: TileProps) {
  return (
    <button
      type="button"
      className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-foreground text-background shadow-sm opacity-0 group-hover:opacity-90 hover:!opacity-100 transition-opacity flex items-center justify-center"
      aria-label={t("assistant.removeAttachment")}
      title={
        item.status === "error" ? t("assistant.uploadFailedRemoveHint") : undefined
      }
      onClick={(e) => {
        e.stopPropagation();
        onRemove(item.id);
      }}
    >
      <X className="h-2.5 w-2.5" strokeWidth={3} />
    </button>
  );
}
