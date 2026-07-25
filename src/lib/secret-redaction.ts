const SENSITIVE_KEY = /(authorization|api[-_]?key|token|secret|password|passwd|credential|cookie|headers?|query|env)/i;

function configuredSecrets(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([key, value]) => SENSITIVE_KEY.test(key) && Boolean(value) && value!.length >= 8)
    .map(([, value]) => value!)
    .sort((left, right) => right.length - left.length);
}

/** Redact credential-shaped strings and values carried by sensitive environment variables. */
export function redactSecretString(value: string, env: NodeJS.ProcessEnv = process.env): string {
  let result = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/([?&](?:authorization|api[-_]?key|token|secret|password|credential|cookie)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/(["'](?:authorization|api[-_]?key|token|secret|password|credential|cookie)["']\s*:\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2")
    .replace(/\b(authorization|api[-_]?key|token|secret|password|credential|cookie)\s*[:=]\s*([^\s,;&]+)/gi, "$1=[REDACTED]");
  for (const secret of configuredSecrets(env)) result = result.split(secret).join("[REDACTED]");
  return result;
}

/** Generic logging/diagnostic boundary. Product-specific payloads may apply tighter limits. */
export function redactSecretValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return redactSecretString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactSecretValue(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSecretValue(entry, depth + 1),
    ]));
  }
  return redactSecretString(String(value ?? ""));
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}
