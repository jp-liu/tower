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
    });
  });

  it("accepts explicit loopback hosts", () => {
    expect(resolveRuntimeNetwork("localhost", 4000).browserUrl).toBe("http://localhost:4000");
    expect(resolveRuntimeNetwork("::1", 4000).browserUrl).toBe("http://[::1]:4000");
    expect(resolveRuntimeNetwork("[::1]", 4000).bindHost).toBe("::1");
  });

  it("rejects wildcard and LAN hosts", () => {
    expect(() => resolveRuntimeNetwork("0.0.0.0", 4000)).toThrow("only accepts loopback hosts");
    expect(() => resolveRuntimeNetwork("::", 4000)).toThrow("only accepts loopback hosts");
    expect(() => resolveRuntimeNetwork("192.168.1.20", 4000)).toThrow("only accepts loopback hosts");
  });

  it("prints the package version and the loopback default without starting Next", () => {
    const cli = resolve(root, "bin/tower.mjs");
    const version = execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim();
    const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(version).toBe(`tower v${pkg.version}`);
    expect(help).toContain("Loopback host (default: 127.0.0.1)");
  });
});
