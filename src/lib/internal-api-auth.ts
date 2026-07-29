import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import {
  INTERNAL_API_HEADERS,
  canonicalInternalRequest,
  hashInternalBody,
  readInternalApiSecret,
  secureInternalEqual,
  signInternalCanonical,
} from "@/lib/internal-api-signing";

const MAX_CLOCK_SKEW_MS = 5 * 60_000;

type ReplayState = { nonces: Map<string, number> };

const globalWithReplay = globalThis as typeof globalThis & {
  __towerInternalApiReplay?: ReplayState;
};
const replay = globalWithReplay.__towerInternalApiReplay ?? { nonces: new Map<string, number>() };
globalWithReplay.__towerInternalApiReplay = replay;

function pruneReplayCache(now: number): void {
  for (const [nonce, expiresAt] of replay.nonces) {
    if (expiresAt <= now) replay.nonces.delete(nonce);
  }
}

export async function requireSignedInternalRequest(
  request: NextRequest,
): Promise<NextResponse | null> {
  const localBlocked = requireLocalhost(request);
  if (localBlocked) return localBlocked;

  const timestamp = request.headers.get(INTERNAL_API_HEADERS.timestamp) ?? "";
  const nonce = request.headers.get(INTERNAL_API_HEADERS.nonce) ?? "";
  const claimedBodyHash = request.headers.get(INTERNAL_API_HEADERS.bodyHash) ?? "";
  const actualSignature = request.headers.get(INTERNAL_API_HEADERS.signature) ?? "";
  const parsedTimestamp = Number(timestamp);
  const now = Date.now();
  if (
    !Number.isFinite(parsedTimestamp)
    || Math.abs(now - parsedTimestamp) > MAX_CLOCK_SKEW_MS
    || !/^[0-9a-f-]{36}$/i.test(nonce)
    || !/^[0-9a-f]{64}$/i.test(claimedBodyHash)
    || !/^[0-9a-f]{64}$/i.test(actualSignature)
  ) {
    return NextResponse.json({ error: "Unauthorized internal request" }, { status: 401 });
  }

  pruneReplayCache(now);
  if (replay.nonces.has(nonce)) {
    return NextResponse.json({ error: "Replayed internal request" }, { status: 409 });
  }

  const body = await request.clone().text();
  if (!secureInternalEqual(hashInternalBody(body), claimedBodyHash)) {
    return NextResponse.json({ error: "Invalid internal request body" }, { status: 401 });
  }
  const secret = readInternalApiSecret();
  if (!secret) {
    return NextResponse.json({ error: "Internal request signing is not initialized" }, { status: 503 });
  }
  const url = new URL(request.url);
  const canonical = canonicalInternalRequest(
    timestamp,
    nonce,
    request.method,
    `${url.pathname}${url.search}`,
    claimedBodyHash,
  );
  if (!secureInternalEqual(signInternalCanonical(secret, canonical), actualSignature)) {
    return NextResponse.json({ error: "Unauthorized internal request" }, { status: 401 });
  }
  replay.nonces.set(nonce, now + MAX_CLOCK_SKEW_MS);
  return null;
}

export function resetInternalApiReplayForTests(): void {
  replay.nonces.clear();
}
