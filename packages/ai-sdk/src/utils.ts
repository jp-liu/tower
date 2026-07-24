export type PlatformName = "darwin" | "linux" | "win32";

export function isWindows(platform: string): platform is "win32" {
  return platform === "win32";
}

export function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

export function normalizePath(value: string, platform: PlatformName): string {
  const separator = isWindows(platform) ? "\\" : "/";
  const unified = isWindows(platform) ? value.replace(/\//g, "\\") : value.replace(/\\/g, "/");
  const prefix = isWindows(platform)
    ? (/^[A-Za-z]:\\/.exec(unified)?.[0] ?? (unified.startsWith("\\\\") ? "\\\\" : ""))
    : (unified.startsWith("/") ? "/" : "");
  const body = prefix ? unified.slice(prefix.length) : unified;
  const parts: string[] = [];
  for (const part of body.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else if (part !== ".." || !prefix) parts.push(part);
  }
  return `${prefix}${parts.join(separator)}` || (prefix || ".");
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
