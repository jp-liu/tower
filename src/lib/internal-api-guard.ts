import { NextRequest, NextResponse } from "next/server";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const CUID_RE = /^c[a-z0-9]{20,30}$/;

/**
 * Localhost-only request guard for internal API routes.
 *
 * Returns a 403 NextResponse if the request is not from a loopback address.
 * Returns null if the request is from localhost (caller should proceed).
 *
 * Multi-layer detection:
 * 1. In the default loopback mode, reject non-loopback forwarded clients.
 * 2. Validate `host` against the resolved production bind host. An explicit
 *    remote bind is an opt-in to remote access; wildcard binds accept the
 *    concrete address used by the client.
 *
 * Note: This app is designed for local-only use on a developer machine.
 * If deployed behind a reverse proxy, add authentication middleware.
 */
export function requireLocalhost(request: NextRequest): NextResponse | null {
  const configuredHost = normalizeHost(process.env.TOWER_RUNTIME_HOST || "127.0.0.1");
  const remoteBinding = !LOOPBACK_HOSTS.includes(configuredHost);

  // Layer 1: If x-forwarded-for is present, ALL IPs must be loopback.
  // Check this FIRST — a proxy sets this header, and if any IP is non-local, reject.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded && !remoteBinding) {
    const ips = forwarded.split(",").map((ip) => ip.trim());
    const allLoopback = ips.every((ip) => LOOPBACK_IPS.has(ip));
    if (!allLoopback) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Layer 2: Check host header — must be a loopback address
  const host = request.headers.get("host") ?? "";
  if (!isRuntimeHostAllowed(host, configuredHost)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // A loopback Host alone does not prove that the caller is Tower: any web page
  // can submit a request to localhost from the user's browser. Reject foreign
  // browser origins while continuing to allow non-browser local daemons, hooks,
  // and MCP clients (which do not send Origin/Sec-Fetch-Site).
  const origin = request.headers.get("origin");
  if (origin && !originMatchesHost(origin, host)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

function normalizeHost(host: string): string {
  const value = host.trim();
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function headerHostname(value: string): string | null {
  try {
    return new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

function originMatchesHost(origin: string, host: string): boolean {
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function isRuntimeHostAllowed(hostHeader: string, configuredHost: string): boolean {
  const hostname = headerHostname(hostHeader);
  if (!hostname) return false;
  const resolved = normalizeHost(configuredHost);
  if (LOOPBACK_HOSTS.includes(resolved)) return LOOPBACK_HOSTS.includes(hostname);
  if (resolved === "0.0.0.0" || resolved === "::") return true;
  return hostname === resolved;
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

/**
 * Validate that a projectId matches CUID format.
 * Prevents path-traversal and injection attacks via malformed projectIds.
 * Returns a 400 NextResponse if invalid, null if valid.
 */
export function validateProjectId(projectId: string): NextResponse | null {
  if (!CUID_RE.test(projectId)) {
    return NextResponse.json({ error: "Invalid projectId format" }, { status: 400 });
  }
  return null;
}
