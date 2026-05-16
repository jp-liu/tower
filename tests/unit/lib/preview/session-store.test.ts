import { describe, it, expect, afterEach } from "vitest";
import {
  getOrCreatePreviewSession,
  getPreviewSession,
  destroyPreviewSession,
  destroyAllPreviewSessions,
} from "@/lib/preview/session-store";

const baseOpts = {
  cwd: process.cwd(),
  command: "node",
  args: ["-e", "setInterval(() => {}, 1000)"],
  port: 9990,
  preset: null,
};

describe("session-store", () => {
  afterEach(() => destroyAllPreviewSessions());

  it("creates new session for new key", () => {
    const s = getOrCreatePreviewSession("k1", baseOpts);
    expect(s.key).toBe("k1");
  });

  it("returns same session for repeated key", () => {
    const a = getOrCreatePreviewSession("k2", baseOpts);
    const b = getOrCreatePreviewSession("k2", baseOpts);
    expect(a).toBe(b);
  });

  it("getPreviewSession returns undefined for unknown key", () => {
    expect(getPreviewSession("nonexistent")).toBeUndefined();
  });

  it("destroyPreviewSession removes from map", () => {
    getOrCreatePreviewSession("k3", baseOpts);
    destroyPreviewSession("k3");
    expect(getPreviewSession("k3")).toBeUndefined();
  });

  it("destroyAllPreviewSessions clears all", () => {
    getOrCreatePreviewSession("k4", baseOpts);
    getOrCreatePreviewSession("k5", baseOpts);
    destroyAllPreviewSessions();
    expect(getPreviewSession("k4")).toBeUndefined();
    expect(getPreviewSession("k5")).toBeUndefined();
  });
});
