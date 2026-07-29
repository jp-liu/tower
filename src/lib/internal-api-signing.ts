import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getTowerDir } from "@/lib/tower-dir";

export const INTERNAL_API_HEADERS = {
  timestamp: "x-tower-timestamp",
  nonce: "x-tower-nonce",
  bodyHash: "x-tower-body-sha256",
  signature: "x-tower-signature",
} as const;

function secretPath(): string {
  return join(getTowerDir(), "secrets", "internal-api.key");
}

export function readInternalApiSecret(): string | null {
  try {
    return readFileSync(secretPath(), "utf8").trim() || null;
  } catch {
    return null;
  }
}

function ensureSecret(): string {
  const existing = readInternalApiSecret();
  if (existing) return existing;
  const file = secretPath();
  mkdirSync(join(getTowerDir(), "secrets"), { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString("base64url");
  try {
    const fd = openSync(file, "wx", 0o600);
    try {
      writeFileSync(fd, `${secret}\n`, "utf8");
    } finally {
      closeSync(fd);
    }
    chmodSync(file, 0o600);
    return secret;
  } catch (error) {
    const raced = readInternalApiSecret();
    if (raced) return raced;
    throw error;
  }
}

export function hashInternalBody(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalInternalRequest(
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  bodyHash: string,
): string {
  return [timestamp, nonce, method.toUpperCase(), path, bodyHash].join("\n");
}

export function signInternalCanonical(secret: string, canonical: string): string {
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export function secureInternalEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function signedInternalFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(input.toString());
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  if (init.body != null && typeof init.body !== "string") {
    throw new Error("Signed Tower internal requests require a string body");
  }
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const bodyHash = hashInternalBody(body);
  const canonical = canonicalInternalRequest(
    timestamp,
    nonce,
    method,
    `${url.pathname}${url.search}`,
    bodyHash,
  );
  const headers = new Headers(init.headers);
  headers.set(INTERNAL_API_HEADERS.timestamp, timestamp);
  headers.set(INTERNAL_API_HEADERS.nonce, nonce);
  headers.set(INTERNAL_API_HEADERS.bodyHash, bodyHash);
  headers.set(
    INTERNAL_API_HEADERS.signature,
    signInternalCanonical(ensureSecret(), canonical),
  );
  return fetch(input, { ...init, method, headers });
}
