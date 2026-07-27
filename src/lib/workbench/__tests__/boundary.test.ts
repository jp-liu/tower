import { afterEach, describe, expect, it, vi } from "vitest";
import {
  markWorkbenchDrainBoundary,
  resetWorkbenchDrainBoundariesForTests,
  scheduleAtWorkbenchDrainBoundary,
} from "@/lib/workbench/boundary";

afterEach(() => {
  resetWorkbenchDrainBoundariesForTests();
  vi.useRealTimers();
});

describe("Workbench drain boundary", () => {
  it("lets a high-priority event shorten but never postpone the coalescing deadline", async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    markWorkbenchDrainBoundary("parent");

    scheduleAtWorkbenchDrainBoundary("parent", 750, callback);
    scheduleAtWorkbenchDrainBoundary("parent", 100, callback);
    scheduleAtWorkbenchDrainBoundary("parent", 900, callback);

    await vi.advanceTimersByTimeAsync(99);
    expect(callback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledOnce();
  });
});
