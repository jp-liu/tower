export const DEFAULT_HOST = "127.0.0.1";

const LOOPBACK_HOSTS = new Set([DEFAULT_HOST, "localhost", "::1"]);

function normalizeHost(value) {
  const rawHost = (value ?? DEFAULT_HOST).trim();
  const host = rawHost.startsWith("[") && rawHost.endsWith("]")
    ? rawHost.slice(1, -1)
    : rawHost;
  if (!host) throw new Error("Host must not be empty");
  const normalizedHost = host.toLowerCase();
  if (!LOOPBACK_HOSTS.has(normalizedHost)) {
    throw new Error(
      `Tower only accepts loopback hosts (${[...LOOPBACK_HOSTS].join(", ")}); received ${host}`,
    );
  }
  return normalizedHost;
}

function urlHost(host) {
  return host.includes(":") ? `[${host}]` : host;
}

export function resolveRuntimeNetwork(hostValue, port) {
  const bindHost = normalizeHost(hostValue);

  return {
    bindHost,
    connectHost: bindHost,
    browserUrl: `http://${urlHost(bindHost)}:${port}`,
  };
}
