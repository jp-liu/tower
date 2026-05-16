import { describe, it, expect, vi } from "vitest";
import { ReadyWatcher } from "@/lib/preview/ready-watcher";
import type { PreviewPreset } from "@/lib/preview/preset-types";

const vitePreset: PreviewPreset = {
  id: "vite",
  name: "Vite",
  icon: "x",
  detect: () => true,
  command: "pnpm dev",
  port: 5173,
  installCommand: null,
  installMarker: null,
  readyRegex: /ready in \d+\s*ms/i,
  urlExtractRegex: /Local:\s+(https?:\/\/[^\s]+)/,
};

describe("ReadyWatcher", () => {
  it("fires onReady when regex matches", () => {
    const onReady = vi.fn();
    const onTimeout = vi.fn();
    const w = new ReadyWatcher(vitePreset, 5173, 60_000, onReady, onTimeout);
    w.feedLine("VITE v5.0 ready in 1247 ms");
    expect(onReady).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("captures URL from urlExtractRegex on a prior line", () => {
    const onReady = vi.fn();
    const w = new ReadyWatcher(vitePreset, 5173, 60_000, onReady, vi.fn());
    w.feedLine("  Local:   http://localhost:5173/");
    w.feedLine("ready in 1247 ms");
    expect(onReady).toHaveBeenCalledWith("http://localhost:5173/");
    w.stop();
  });

  it("fires onReady only once for multiple matching lines", () => {
    const onReady = vi.fn();
    const w = new ReadyWatcher(vitePreset, 5173, 60_000, onReady, vi.fn());
    w.feedLine("ready in 1 ms");
    w.feedLine("ready in 2 ms");
    expect(onReady).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("fires onTimeout when no signal arrives in time", () =>
    new Promise<void>((resolve) => {
      const onTimeout = vi.fn(() => {
        expect(onTimeout).toHaveBeenCalled();
        w.stop();
        resolve();
      });
      const w = new ReadyWatcher(vitePreset, 5173, 50, vi.fn(), onTimeout);
      w.start();
    }));

  it("stop() clears timeout and probe — no callbacks fire after stop", async () => {
    const onReady = vi.fn();
    const onTimeout = vi.fn();
    const w = new ReadyWatcher(vitePreset, 5173, 50, onReady, onTimeout);
    w.start();
    w.stop();
    await new Promise((r) => setTimeout(r, 100));
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
});
