export const DEFAULT_HOST = "127.0.0.1";

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::"]);

function normalizeHost(value) {
  const host = (value ?? DEFAULT_HOST).trim();
  if (!host) throw new Error("Host must not be empty");
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function urlHost(host) {
  return host.includes(":") ? `[${host}]` : host;
}

export function resolveRuntimeNetwork(hostValue, port) {
  const bindHost = normalizeHost(hostValue);
  const wildcard = WILDCARD_HOSTS.has(bindHost);
  const connectHost = bindHost === "0.0.0.0" ? "127.0.0.1"
    : bindHost === "::" ? "::1"
      : bindHost;
  const browserHost = wildcard ? "localhost" : connectHost;

  return {
    bindHost,
    connectHost,
    browserUrl: `http://${urlHost(browserHost)}:${port}`,
    explicitRemote: bindHost !== DEFAULT_HOST && bindHost !== "localhost" && bindHost !== "::1",
  };
}
