import { NextRequest, NextResponse } from "next/server";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const CUID_RE = /^c[a-z0-9]{20,30}$/;

/**
 * Localhost-only request guard for internal API routes.
 *
 * Returns a 403 NextResponse if the request is not from a loopback address.
 * Returns null if the request is from localhost (caller should proceed).
 *
 * Multi-layer detection:
 * 1. Reject if x-forwarded-for contains any non-loopback IP (proxy bypass prevention)
 * 2. Check `host` header — must start with `localhost`, `127.0.0.1`, or `[::1]`
 *
 * Note: This app is designed for local-only use on a developer machine.
 * If deployed behind a reverse proxy, add authentication middleware.
 */
export function requireLocalhost(request: NextRequest): NextResponse | null {
  // Layer 1: If x-forwarded-for is present, ALL IPs must be loopback.
  // Check this FIRST — a proxy sets this header, and if any IP is non-local, reject.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",").map((ip) => ip.trim());
    const allLoopback = ips.every((ip) => LOOPBACK_IPS.has(ip));
    if (!allLoopback) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Layer 2: Check host header — must be a loopback address
  const host = request.headers.get("host") ?? "";
  const isLocalhostHost = LOOPBACK_HOSTS.some((h) => host.startsWith(h));
  if (!isLocalhostHost) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

/**
 * Validate that a taskId matches CUID format.
 * Returns a 400 NextResponse if invalid, null if valid.
 */
export function validateTaskId(taskId: string): NextResponse | null {
  if (!CUID_RE.test(taskId)) {
    return NextResponse.json({ error: "Invalid taskId format" }, { status: 400 });
  }
  return null;
}
