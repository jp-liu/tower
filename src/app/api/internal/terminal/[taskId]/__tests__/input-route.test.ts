import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/pty/session-store", () => ({
  getSession: mocks.getSession,
}));
vi.mock("@/lib/internal-api-guard", () => ({
  requireLocalhost: vi.fn(() => null),
  validateTaskId: vi.fn(() => null),
}));

import { POST } from "../input/route";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/internal/terminal/task-1/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

describe("internal terminal input idempotency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits one keyed input and deduplicates the retry", async () => {
    const accepted = new Set<string>();
    const pending = new Set<string>();
    const session = {
      killed: false,
      writeRaw: vi.fn(),
      writeSubmittedInput: vi.fn(),
      claimInputKey: vi.fn((key: string) => {
        if (accepted.has(key)) return "accepted";
        if (pending.has(key)) return "pending";
        pending.add(key);
        return "claimed";
      }),
      acceptInputKey: vi.fn((key: string) => {
        pending.delete(key);
        accepted.add(key);
      }),
      releaseInputKey: vi.fn((key: string) => pending.delete(key)),
    };
    mocks.getSession.mockReturnValue(session);

    const first = await POST(request({
      text: "continue",
      submit: true,
      submitDelayMs: 0,
      idempotencyKey: "gateway-inbound-1",
    }), { params: Promise.resolve({ taskId: "task-1" }) });
    const duplicate = await POST(request({
      text: "continue",
      submit: true,
      submitDelayMs: 0,
      idempotencyKey: "gateway-inbound-1",
    }), { params: Promise.resolve({ taskId: "task-1" }) });

    expect(await first.json()).toMatchObject({ ok: true, deduped: false });
    expect(await duplicate.json()).toMatchObject({ ok: true, deduped: true });
    expect(session.writeRaw).toHaveBeenCalledWith("continue");
    expect(session.writeSubmittedInput).toHaveBeenCalledWith("\r");
  });

  it("returns a retryable conflict while the same key is pending", async () => {
    const session = {
      killed: false,
      writeRaw: vi.fn(),
      writeSubmittedInput: vi.fn(),
      claimInputKey: vi.fn(() => "pending"),
      acceptInputKey: vi.fn(),
      releaseInputKey: vi.fn(),
    };
    mocks.getSession.mockReturnValue(session);

    const response = await POST(request({
      text: "continue",
      idempotencyKey: "gateway-inbound-1",
    }), { params: Promise.resolve({ taskId: "task-1" }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ inProgress: true });
    expect(session.writeRaw).not.toHaveBeenCalled();
    expect(session.writeSubmittedInput).not.toHaveBeenCalled();
  });

  it("forwards unsubmitted text without opening a provider turn", async () => {
    const session = {
      killed: false,
      writeRaw: vi.fn(),
      writeSubmittedInput: vi.fn(),
      claimInputKey: vi.fn(),
      acceptInputKey: vi.fn(),
      releaseInputKey: vi.fn(),
    };
    mocks.getSession.mockReturnValue(session);

    const response = await POST(request({ text: "draft", submit: false }), {
      params: Promise.resolve({ taskId: "task-1" }),
    });

    expect(response.status).toBe(200);
    expect(session.writeRaw).toHaveBeenCalledWith("draft");
    expect(session.writeSubmittedInput).not.toHaveBeenCalled();
  });
});
