// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock("@/lib/gateway/capability-runtime", () => ({
  reconcileCapabilityCompletion: mocks.reconcile,
}));

import { POST } from "../route";

const requestId = "4cc2791f-fbc9-47af-b410-4bd0586ae941";
const token = "callback_token_with_at_least_thirty_two_chars";

function request(headers: Record<string, string> = {}) {
  return new NextRequest(
    "http://127.0.0.1:3000/api/internal/harness/capabilities/completions",
    {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json", ...headers },
      body: JSON.stringify({ requestId, runId: "run-1" }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reconcile.mockResolvedValue({ status: "SUCCEEDED" });
});

describe("capability completion callback route", () => {
  it("requires a per-Job bearer token", async () => {
    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("passes only request identity and the scoped token to authoritative reconciliation", async () => {
    const response = await POST(request({ authorization: `Bearer ${token}` }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, requestId, status: "SUCCEEDED" });
    expect(mocks.reconcile).toHaveBeenCalledWith({
      requestId,
      runId: "run-1",
      callbackToken: token,
    });
  });

  it("rejects non-loopback callers before token validation", async () => {
    const response = await POST(new NextRequest(
      "http://127.0.0.1:3000/api/internal/harness/capabilities/completions",
      {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.10",
        },
        body: JSON.stringify({ requestId, runId: "run-1" }),
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
