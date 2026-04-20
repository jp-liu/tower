import { describe, it, expect } from "vitest";
import { requireLocalhost, validateTaskId, validateProjectId } from "../internal-api-guard";
import { NextRequest } from "next/server";

function makeRequest(host: string, headers?: Record<string, string>): NextRequest {
  const url = `http://${host}/api/internal/test`;
  return new NextRequest(url, {
    headers: { host, ...headers },
  });
}

describe("requireLocalhost", () => {
  it("allows request from localhost:3000 (no x-forwarded-for)", () => {
    const req = makeRequest("localhost:3000");
    expect(requireLocalhost(req)).toBeNull();
  });

  it("allows request from 127.0.0.1:3000 (no x-forwarded-for)", () => {
    const req = makeRequest("127.0.0.1:3000");
    expect(requireLocalhost(req)).toBeNull();
  });

  it("allows request from [::1]:3000 (IPv6 loopback, no x-forwarded-for)", () => {
    const req = makeRequest("[::1]:3000");
    expect(requireLocalhost(req)).toBeNull();
  });

  it("blocks request from evil.com (403)", async () => {
    const req = makeRequest("evil.com");
    const res = requireLocalhost(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toBe("Forbidden");
  });

  it("blocks request from 10.0.0.5 (non-loopback host, 403)", async () => {
    const req = makeRequest("10.0.0.5");
    const res = requireLocalhost(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("allows request with x-forwarded-for 127.0.0.1 from localhost", () => {
    const req = makeRequest("localhost:3000", { "x-forwarded-for": "127.0.0.1" });
    expect(requireLocalhost(req)).toBeNull();
  });

  it("blocks request with spoofed x-forwarded-for 192.168.1.100 from localhost (403)", async () => {
    const req = makeRequest("localhost:3000", { "x-forwarded-for": "192.168.1.100" });
    const res = requireLocalhost(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toBe("Forbidden");
  });

  it("blocks request with mixed x-forwarded-for chain containing a non-loopback IP (403)", async () => {
    const req = makeRequest("localhost:3000", {
      "x-forwarded-for": "127.0.0.1, 192.168.1.1",
    });
    const res = requireLocalhost(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("allows request with x-forwarded-for ::1 (IPv6 loopback) from localhost", () => {
    const req = makeRequest("localhost:3000", { "x-forwarded-for": "::1" });
    expect(requireLocalhost(req)).toBeNull();
  });

  it("allows request with x-forwarded-for ::ffff:127.0.0.1 (IPv4-mapped) from localhost", () => {
    const req = makeRequest("localhost:3000", {
      "x-forwarded-for": "::ffff:127.0.0.1",
    });
    expect(requireLocalhost(req)).toBeNull();
  });

  it("allows request with empty x-forwarded-for header (empty string is falsy, treated as absent)", () => {
    const req = makeRequest("localhost:3000", { "x-forwarded-for": "" });
    // Empty string is falsy in JS, so the forwarded-IP check is skipped entirely.
    // The host header check then passes for localhost:3000.
    const res = requireLocalhost(req);
    expect(res).toBeNull();
  });

  it("blocks request with no host header (403)", async () => {
    // Create a request with an explicit empty host
    const url = "http://127.0.0.1/api/internal/test";
    const req = new NextRequest(url, {
      headers: { host: "unknown-host.example.com" },
    });
    const res = requireLocalhost(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});

describe("validateTaskId", () => {
  it("accepts a valid CUID", () => {
    expect(validateTaskId("clh1234567890abcdefghij")).toBeNull();
  });

  it("rejects 'not-a-cuid' with 400", async () => {
    const res = validateTaskId("not-a-cuid");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = await res!.json();
    expect(body.error).toContain("Invalid taskId");
  });

  it("rejects empty string with 400", async () => {
    const res = validateTaskId("");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
  });

  it("rejects uppercase CUID-like string with 400 (regex is lowercase-only)", async () => {
    const res = validateTaskId("CLH1234567890ABCDEFGHIJ");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
  });
});

describe("validateProjectId", () => {
  it("accepts a valid CUID", () => {
    expect(validateProjectId("clh1234567890abcdefghij")).toBeNull();
  });

  it("rejects 'not-a-cuid' with 400 and 'Invalid projectId format'", async () => {
    const res = validateProjectId("not-a-cuid");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = await res!.json();
    expect(body.error).toBe("Invalid projectId format");
  });

  it("rejects path traversal string '../../../etc' with 400", async () => {
    const res = validateProjectId("../../../etc");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = await res!.json();
    expect(body.error).toBe("Invalid projectId format");
  });

  it("rejects empty string with 400", async () => {
    const res = validateProjectId("");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
  });
});
