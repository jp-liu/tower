import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  requireSignedInternalRequest,
  resetInternalApiReplayForTests,
} from "../internal-api-auth";
import { signedInternalFetch } from "../internal-api-signing";

let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(() => {
  previousDataDir = process.env.TOWER_DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "tower-internal-auth-"));
  process.env.TOWER_DATA_DIR = dataDir;
  resetInternalApiReplayForTests();
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.TOWER_DATA_DIR;
  else process.env.TOWER_DATA_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

async function captureSignedRequest(body: string) {
  let captured: { input: string | URL | Request; init?: RequestInit } | null = null;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    captured = { input, init };
    return new Response("ok");
  }));
  await signedInternalFetch("http://localhost:3000/api/internal/harness/gateway?x=1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!captured) throw new Error("signed fetch was not captured");
  const request = captured as { input: string | URL | Request; init?: RequestInit };
  return new NextRequest(request.input, {
    method: request.init?.method,
    headers: {
      ...(Object.fromEntries(new Headers(request.init?.headers))),
      host: "localhost:3000",
    },
    body,
  });
}

describe("signed Tower internal API requests", () => {
  it("accepts a valid signed request and creates a private secret", async () => {
    const request = await captureSignedRequest('{"ok":true}');
    await expect(requireSignedInternalRequest(request)).resolves.toBeNull();
    expect(statSync(join(dataDir, "secrets", "internal-api.key")).mode & 0o777).toBe(0o600);
  });

  it("rejects body tampering", async () => {
    const signed = await captureSignedRequest('{"ok":true}');
    const tampered = new NextRequest(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: '{"ok":false}',
    });
    const response = await requireSignedInternalRequest(tampered);
    expect(response?.status).toBe(401);
  });

  it("rejects replay of a valid signed request", async () => {
    const request = await captureSignedRequest('{"ok":true}');
    expect(await requireSignedInternalRequest(request)).toBeNull();
    const response = await requireSignedInternalRequest(request);
    expect(response?.status).toBe(409);
  });
});
