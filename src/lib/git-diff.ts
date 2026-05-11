import parseDiff from "parse-diff";
import type { File, Chunk } from "parse-diff";

export function normalizeLF(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

export type DiffFile = File;
export type DiffChunk = Chunk;

export function parseUnifiedDiff(patch: string): DiffFile[] {
  return parseDiff(normalizeLF(patch));
}

const DEV_NULL = "/dev/null";

function isMissing(path: string | undefined): boolean {
  return !path || path === DEV_NULL;
}

export function hunkToPatch(file: DiffFile, hunk: DiffChunk): string {
  // parse-diff reports the absent side as "/dev/null" for new/deleted files.
  // git apply requires:
  //   - The `diff --git` line to use the SURVIVING path on BOTH sides (never /dev/null).
  //   - The `--- ` / `+++ ` lines to use /dev/null for the missing side.
  const fromMissing = isMissing(file.from);
  const toMissing = isMissing(file.to);
  const survivingPath = fromMissing ? (file.to ?? "") : (file.from ?? "");
  const gitPath = fromMissing || toMissing ? survivingPath : (file.from ?? file.to ?? "");

  const fromLine = fromMissing ? `--- ${DEV_NULL}` : `--- a/${file.from}`;
  const toLine = toMissing ? `+++ ${DEV_NULL}` : `+++ b/${file.to}`;

  const header = [
    `diff --git a/${gitPath} b/${gitPath}`,
    fromLine,
    toLine,
  ].join("\n");

  // NOTE: depends on parse-diff storing the marker (+/-/space) in `change.content`
  // (verified in 0.12.0 — see node_modules/parse-diff/index.d.ts). If a future
  // parse-diff version separates marker from content, reconstruct via change.type.
  const lines: string[] = [hunk.content];
  for (const change of hunk.changes) {
    lines.push(change.content);
  }
  return `${header}\n${lines.join("\n")}\n`;
}
