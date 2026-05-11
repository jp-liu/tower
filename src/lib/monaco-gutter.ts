import type { DiffChunk } from "@/lib/git-diff";

// ── Types ──────────────────────────────────────────────────────────────────────

type MonacoEditor = {
  deltaDecorations: (oldIds: string[], next: unknown[]) => string[];
};

type MonacoRange = new (
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
) => unknown;

type MonacoApi = { Range: MonacoRange };

export type GutterHunkKind = "add" | "modify" | "delete";

export interface GutterHunk {
  newStart: number;
  newLines: number;
  kind: GutterHunkKind;
}

// ── State ──────────────────────────────────────────────────────────────────────

/**
 * WeakMap keyed by editor instance so decoration IDs are automatically
 * garbage-collected when the editor is destroyed.
 */
const decorationsByEditor = new WeakMap<MonacoEditor, string[]>();

// ── Core helpers ───────────────────────────────────────────────────────────────

/**
 * Apply (or replace) gutter decorations for the given hunks on a Monaco editor.
 * Idempotent: previous IDs are passed as `oldIds` so Monaco removes them first.
 * Returns the new decoration IDs.
 */
export function applyGutterDecorations(
  editor: MonacoEditor,
  monaco: MonacoApi,
  hunks: GutterHunk[],
): string[] {
  const next = hunks.map((h) => {
    const startLine = Math.max(1, h.newStart);
    const endLine = Math.max(startLine, startLine + Math.max(h.newLines, 1) - 1);
    return {
      range: new monaco.Range(startLine, 1, endLine, 1),
      options: { linesDecorationsClassName: `line-${h.kind}` },
    };
  });

  const old = decorationsByEditor.get(editor) ?? [];
  const ids = editor.deltaDecorations(old, next);
  decorationsByEditor.set(editor, ids);
  return ids;
}

/**
 * Remove all gutter decorations from an editor and clear the stored IDs.
 * No-op if no decorations are currently tracked.
 */
export function clearGutterDecorations(editor: MonacoEditor): void {
  const old = decorationsByEditor.get(editor) ?? [];
  if (old.length > 0) {
    editor.deltaDecorations(old, []);
    decorationsByEditor.delete(editor);
  }
}

// ── Conversion helper (used by Task 11) ───────────────────────────────────────

/**
 * Convert parse-diff `Chunk` objects (re-exported as `DiffChunk` from
 * `@/lib/git-diff`) into `GutterHunk[]` suitable for `applyGutterDecorations`.
 *
 * Classification:
 *   - only adds  → "add"
 *   - only dels  → "delete"
 *   - mixed      → "modify"
 */
export function chunksToGutterHunks(chunks: DiffChunk[]): GutterHunk[] {
  return chunks.map((c) => {
    const adds = c.changes.filter((ch) => ch.type === "add").length;
    const dels = c.changes.filter((ch) => ch.type === "del").length;

    let kind: GutterHunkKind;
    if (dels === 0 && adds > 0) kind = "add";
    else if (adds === 0 && dels > 0) kind = "delete";
    else kind = "modify";

    return { newStart: c.newStart, newLines: c.newLines, kind };
  });
}
