import path from "node:path";

export type PlatformName = "darwin" | "linux" | "win32";

export function isWindows(platform: string): platform is "win32" {
  return platform === "win32";
}

export function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

export function normalizePath(value: string, platform: PlatformName): string {
  if (isWindows(platform)) return path.win32.normalize(value.replace(/\//g, "\\"));
  return path.posix.normalize(value.replace(/\\/g, "/"));
}

export function quoteForCmd(argument: string): string {
  const flattened = argument.replace(/\r\n|\r|\n/g, " ");
  if (!flattened.length) return '\"\"';
  const escaped = flattened.replace(/"/g, '\"\"');
  return /[\s"&<>|^()]/.test(escaped) ? `"${escaped}"` : escaped;
}

/** Detect shell syntax that must never be accepted as a structured executable. */
export function isShellCommandString(command: string): boolean {
  return /[\r\n]|&&|\|\||[;|<>]/.test(command);
}

const SENSITIVE_KEY_PATTERN = /key|token|secret|password|passwd|authorization|cookie/i;

export function redactSensitiveRecord<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY_PATTERN.test(key) ? "***REDACTED***" : entry;
  }
  return redacted;
}
