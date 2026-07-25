import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_HOST, resolveRuntimeNetwork } from "../../../bin/network.mjs";

const root = resolve(import.meta.dirname, "../../..");

describe("Tower production CLI", () => {
  it("defaults to the IPv4 loopback address", () => {
    expect(DEFAULT_HOST).toBe("127.0.0.1");
    expect(resolveRuntimeNetwork(undefined, 3000)).toEqual({
      bindHost: "127.0.0.1",
      connectHost: "127.0.0.1",
      browserUrl: "http://127.0.0.1:3000",
      explicitRemote: false,
    });
  });

  it("preserves explicit wildcard, LAN, and IPv6 hosts", () => {
    expect(resolveRuntimeNetwork("0.0.0.0", 4000)).toMatchObject({
      bindHost: "0.0.0.0",
      connectHost: "127.0.0.1",
      browserUrl: "http://localhost:4000",
    });
    expect(resolveRuntimeNetwork("192.168.1.20", 4000)).toMatchObject({
      bindHost: "192.168.1.20",
      connectHost: "192.168.1.20",
      browserUrl: "http://192.168.1.20:4000",
    });
    expect(resolveRuntimeNetwork("::1", 4000).browserUrl).toBe("http://[::1]:4000");
  });

  it("prints 0.3.0 and the loopback default without starting Next", () => {
    const cli = resolve(root, "bin/tower.mjs");
    const version = execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim();
    const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(version).toBe(`tower v${pkg.version}`);
    expect(version).toBe("tower v0.3.0");
    expect(help).toContain("Server host (default: 127.0.0.1)");
  });
});
