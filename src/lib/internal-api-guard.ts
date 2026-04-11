import { NextRequest, NextResponse } from "next/server";

/**
 * Localhost-only request guard for internal API routes.
 *
 * Returns a 403 NextResponse if the request is not from a loopback address.
 * Returns null if the request is from localhost (caller should proceed).
 *
 * Detection strategy (header-based only — request.ip is unreliable in all Next.js runtimes):
 * 1. Check `host` header — must start with `localhost`, `127.0.0.1`, or `[::1]`
 * 2. Check `x-forwarded-for` — if present, ALL IPs must be loopback
 */
export function requireLocalhost(request: NextRequest): NextResponse | null {
  const host = request.headers.get("host") ?? "";
  const isLocalhostHost =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]");

  if (!isLocalhostHost) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // If x-forwarded-for is present, all IPs must be loopback
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",").map((ip) => ip.trim());
    const allLoopback = ips.every(
      (ip) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1"
    );
    if (!allLoopback) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return null;
}
