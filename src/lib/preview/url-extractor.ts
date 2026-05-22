// No external dependencies — self-contained ANSI strip + URL extraction
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, "");
}

const DEFAULT_URL_REGEX = /(https?:\/\/[^\s]+)/;

export function extractUrl(line: string, regex?: RegExp): string | null {
  const clean = stripAnsi(line);
  const m = clean.match(regex ?? DEFAULT_URL_REGEX);
  return m?.[1] ?? null;
}
