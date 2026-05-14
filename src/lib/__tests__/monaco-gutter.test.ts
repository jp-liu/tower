import { describe, it, expect, vi } from "vitest";
import { applyGutterDecorations, clearGutterDecorations, chunksToGutterHunks } from "../monaco-gutter";
import type { GutterHunk } from "../monaco-gutter";
import type { DiffChunk } from "../git-diff";

// ── Mock Monaco Range ──────────────────────────────────────────────────────────

class MockRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;

  constructor(
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number,
  ) {
    this.startLineNumber = startLineNumber;
    this.startColumn = startColumn;
    this.endLineNumber = endLineNumber;
    this.endColumn = endColumn;
  }
}

function makeMockMonaco() {
  return { Range: MockRange as unknown as ConstructorParameters<typeof MockRange>[0] & (new (...args: number[]) => MockRange) };
}

// ── Mock Editor ───────────────────────────────────────────────────────────────

function makeMockEditor(returnIds: string[]) {
  return {
    deltaDecorations: vi.fn((_oldIds: string[], next: unknown[]) =>
      next.map((_, i) => returnIds[i] ?? `id-${i}`),
    ),
  };
}

// ── Test data ─────────────────────────────────────────────────────────────────

const hunk1: GutterHunk = { newStart: 1, newLines: 3, kind: "add" };
const hunk2: GutterHunk = { newStart: 10, newLines: 2, kind: "modify" };
const hunk3: GutterHunk = { newStart: 20, newLines: 1, kind: "delete" };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("applyGutterDecorations", () => {
  it("first call passes [] as oldIds and stores the returned IDs", () => {
    const editor = makeMockEditor(["id-0", "id-1"]);
    const monaco = { Range: MockRange as unknown as typeof MockRange };

    const ids = applyGutterDecorations(editor, monaco as any, [hunk1, hunk2]);

    expect(editor.deltaDecorations).toHaveBeenCalledTimes(1);
    const [oldIds, next] = editor.deltaDecorations.mock.calls[0];
    expect(oldIds).toEqual([]);
    expect(next).toHaveLength(2);
    expect(ids).toEqual(["id-0", "id-1"]);
  });

  it("second call passes previous returned IDs as oldIds", () => {
    const editor = makeMockEditor(["id-0", "id-1"]);
    const monaco = { Range: MockRange as unknown as typeof MockRange };

    // First call — returns ["id-0", "id-1"]
    applyGutterDecorations(editor, monaco as any, [hunk1, hunk2]);

    // Reset mock for clarity, but keep the editor reference
    editor.deltaDecorations.mockClear();
    // Second call returns different ids
    (editor.deltaDecorations as ReturnType<typeof vi.fn>).mockImplementation(
      (_old: string[], next: unknown[]) => next.map((_, i) => `new-${i}`),
    );

    applyGutterDecorations(editor, monaco as any, [hunk2]);

    expect(editor.deltaDecorations).toHaveBeenCalledTimes(1);
    const [oldIds] = editor.deltaDecorations.mock.calls[0];
    // Must pass the IDs from the FIRST call as oldIds
    expect(oldIds).toEqual(["id-0", "id-1"]);
  });

  it("synthesizes correct decorations for each hunk kind", () => {
    const editor = makeMockEditor(["id-0", "id-1", "id-2"]);
    const monaco = { Range: MockRange as unknown as typeof MockRange };

    applyGutterDecorations(editor, monaco as any, [hunk1, hunk2, hunk3]);

    const [, next] = editor.deltaDecorations.mock.calls[0];
    const decorations = next as Array<{
      range: MockRange;
      options: { linesDecorationsClassName: string };
    }>;

    // hunk1: add, lines 1–3
    expect(decorations[0].options.linesDecorationsClassName).toBe("line-add");
    expect(decorations[0].range.startLineNumber).toBe(1);
    expect(decorations[0].range.endLineNumber).toBe(3);

    // hunk2: modify, lines 10–11
    expect(decorations[1].options.linesDecorationsClassName).toBe("line-modify");
    expect(decorations[1].range.startLineNumber).toBe(10);
    expect(decorations[1].range.endLineNumber).toBe(11);

    // hunk3: delete, line 20
    expect(decorations[2].options.linesDecorationsClassName).toBe("line-delete");
    expect(decorations[2].range.startLineNumber).toBe(20);
    expect(decorations[2].range.endLineNumber).toBe(20);
  });

  it("handles zero newLines by treating span as 1 line", () => {
    const editor = makeMockEditor(["id-0"]);
    const monaco = { Range: MockRange as unknown as typeof MockRange };

    const hunk: GutterHunk = { newStart: 5, newLines: 0, kind: "delete" };
    applyGutterDecorations(editor, monaco as any, [hunk]);

    const [, next] = editor.deltaDecorations.mock.calls[0];
    const dec = (next as Array<{ range: MockRange }>)[0];
    expect(dec.range.startLineNumber).toBe(5);
    expect(dec.range.endLineNumber).toBe(5);
  });
});

describe("clearGutterDecorations", () => {
  it("calls deltaDecorations with previous IDs and [] to clear, then removes from WeakMap", () => {
    const editor = makeMockEditor(["id-0", "id-1"]);
    const monaco = { Range: MockRange as unknown as typeof MockRange };

    applyGutterDecorations(editor, monaco as any, [hunk1, hunk2]);
    editor.deltaDecorations.mockClear();

    clearGutterDecorations(editor);

    expect(editor.deltaDecorations).toHaveBeenCalledTimes(1);
    expect(editor.deltaDecorations.mock.calls[0][0]).toEqual(["id-0", "id-1"]);
    expect(editor.deltaDecorations.mock.calls[0][1]).toEqual([]);

    // Second clear should be a no-op (nothing stored)
    editor.deltaDecorations.mockClear();
    clearGutterDecorations(editor);
    expect(editor.deltaDecorations).not.toHaveBeenCalled();
  });
});

describe("chunksToGutterHunks", () => {
  it("classifies pure-add chunk as 'add'", () => {
    const chunk: DiffChunk = {
      content: "@@ -0,0 +1,2 @@",
      changes: [
        { type: "add", add: true, ln: 1, content: "+a" },
        { type: "add", add: true, ln: 2, content: "+b" },
      ],
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 2,
    };
    const hunks = chunksToGutterHunks([chunk]);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].kind).toBe("add");
    expect(hunks[0].newStart).toBe(1);
    expect(hunks[0].newLines).toBe(2);
  });

  it("classifies pure-delete chunk as 'delete'", () => {
    const chunk: DiffChunk = {
      content: "@@ -1,2 +0,0 @@",
      changes: [
        { type: "del", del: true, ln: 1, content: "-a" },
        { type: "del", del: true, ln: 2, content: "-b" },
      ],
      oldStart: 1,
      oldLines: 2,
      newStart: 0,
      newLines: 0,
    };
    const hunks = chunksToGutterHunks([chunk]);
    expect(hunks[0].kind).toBe("delete");
  });

  it("classifies mixed add+del chunk as 'modify'", () => {
    const chunk: DiffChunk = {
      content: "@@ -1,1 +1,1 @@",
      changes: [
        { type: "del", del: true, ln: 1, content: "-old" },
        { type: "add", add: true, ln: 1, content: "+new" },
      ],
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
    };
    const hunks = chunksToGutterHunks([chunk]);
    expect(hunks[0].kind).toBe("modify");
  });

  it("returns empty array for empty input", () => {
    expect(chunksToGutterHunks([])).toEqual([]);
  });
});
