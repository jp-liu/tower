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
