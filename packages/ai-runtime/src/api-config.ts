import type { ApiConfigEntry, ApiProtocol } from "./api-types.js";

const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
]);
const SENSITIVE_NAME = /(authorization|token|key|secret|cookie)/i;
const TOKEN_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function normalizeBaseUrl(value: string): string {
  const normalized = value.trim();
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Base URL must be a valid absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL must use http or https");
  }
  if (url.username || url.password) throw new Error("Base URL must not contain credentials");
  if (url.hash) throw new Error("Base URL must not contain a fragment");
  url.pathname = url.pathname.replace(/\/+$/, "");
  const serialized = url.toString();
  return url.pathname === "/"
    ? `${url.origin}${serialized.slice(url.origin.length + 1)}`
    : serialized;
}

export function defaultSensitive(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}

export function validateConfigEntries(
  entries: ApiConfigEntry[],
  kind: "header" | "query",
): ApiConfigEntry[] {
  const ids = new Set<string>();
  return entries.map((entry) => {
    const name = entry.name.trim();
    if (!entry.id || ids.has(entry.id)) throw new Error(`${kind} entry ids must be unique`);
    ids.add(entry.id);
    if (!name) throw new Error(`${kind} name must not be empty`);
    if (kind === "header") {
      if (!TOKEN_NAME.test(name)) throw new Error("Header name is invalid");
      if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
        throw new Error(`Header ${name} is controlled by the transport`);
      }
      if (/[\r\n]/.test(entry.value)) throw new Error("Header value must not contain newlines");
    }
    return {
      ...entry,
      name,
      sensitive: entry.sensitive || defaultSensitive(name),
    };
  });
}

export function parseConfigEntries(value: string, kind: "header" | "query"): ApiConfigEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Stored ${kind} configuration is invalid JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`Stored ${kind} configuration must be an array`);
  const entries = parsed.map((item) => {
    if (!item || typeof item !== "object") throw new Error(`Stored ${kind} entry is invalid`);
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      typeof row.value !== "string" ||
      typeof row.enabled !== "boolean" ||
      typeof row.sensitive !== "boolean"
    ) {
      throw new Error(`Stored ${kind} entry has invalid fields`);
    }
    return row as unknown as ApiConfigEntry;
  });
  return validateConfigEntries(entries, kind);
}

export function serializeConfigEntries(entries: ApiConfigEntry[], kind: "header" | "query"): string {
  return JSON.stringify(validateConfigEntries(entries, kind));
}

export function assertApiProtocol(value: string): ApiProtocol {
  if (value === "openai" || value === "openai-compatible" || value === "anthropic" || value === "google") {
    return value;
  }
  throw new Error("Unsupported API protocol");
}
