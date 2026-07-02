import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getSignalDir } from "@/lib/tower-dir";

// Regression: prod (~/.tower) and dev (~/.tower-dev) run in parallel on one host.
// The signal dir used to be a global $TMPDIR/tower-signals shared by both, so
// dev's boot-time orphan reaper read prod's LIVE pid files and SIGKILLed prod's
// running terminals. getSignalDir() now keys the dir by TOWER_DATA_DIR.

const PROD_ROOT = `/tmp/tower-test-prod-${process.pid}`;
const DEV_ROOT = `/tmp/tower-test-dev-${process.pid}`;

describe("signal dir isolation by data root", () => {
  const orig = process.env.TOWER_DATA_DIR;

  afterEach(() => {
    if (orig === undefined) delete process.env.TOWER_DATA_DIR;
    else process.env.TOWER_DATA_DIR = orig;
    vi.resetModules();
  });

  it("gives prod and dev distinct dirs, stable per root", () => {
    process.env.TOWER_DATA_DIR = PROD_ROOT;
    const prod = getSignalDir();
    process.env.TOWER_DATA_DIR = DEV_ROOT;
    const dev = getSignalDir();

    expect(prod).not.toBe(dev);
    process.env.TOWER_DATA_DIR = PROD_ROOT;
    expect(getSignalDir()).toBe(prod); // same root → same dir (writer/reader agree)
  });

  it("a dev instance's reaper never reads or deletes prod's pid file", async () => {
    process.env.TOWER_DATA_DIR = PROD_ROOT;
    const prodSig = getSignalDir();
    await mkdir(prodSig, { recursive: true, mode: 0o700 });
    const prodPid = join(prodSig, "pid-prodtask");
    await writeFile(prodPid, "1"); // pid<=1 → no kill even if wrongly read

    // Boot the reaper as the dev instance would.
    process.env.TOWER_DATA_DIR = DEV_ROOT;
    vi.resetModules();
    const { reapOrphanedProcesses } = await import("@/lib/pty/orphan-reaper");
    const killed = await reapOrphanedProcesses();

    expect(killed).toBe(0);
    expect(existsSync(prodPid)).toBe(true); // prod's file untouched

    await rm(prodSig, { recursive: true, force: true });
  });
});
