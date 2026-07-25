import { describe, expect, it } from "vitest";
import { isAllowedWsOrigin } from "../ws-server";

describe("WebSocket runtime origins", () => {
  it("allows loopback origins for the default production host", () => {
    expect(isAllowedWsOrigin("http://127.0.0.1:3000", "127.0.0.1:3001", "127.0.0.1", 3000)).toBe(true);
    expect(isAllowedWsOrigin("http://localhost:3000", "localhost:3001", "127.0.0.1", 3000)).toBe(true);
    expect(isAllowedWsOrigin("http://evil.example:3000", "127.0.0.1:3001", "127.0.0.1", 3000)).toBe(false);
  });

  it("allows the explicit LAN host and matches concrete wildcard origins", () => {
    expect(isAllowedWsOrigin("http://192.168.1.20:4000", "192.168.1.20:4001", "192.168.1.20", 4000)).toBe(true);
    expect(isAllowedWsOrigin("http://192.168.1.20:4000", "192.168.1.20:4001", "0.0.0.0", 4000)).toBe(true);
    expect(isAllowedWsOrigin("http://192.168.1.21:4000", "192.168.1.20:4001", "0.0.0.0", 4000)).toBe(false);
  });
});
