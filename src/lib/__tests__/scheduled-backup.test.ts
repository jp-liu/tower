// @vitest-environment node
import { closeSync, mkdirSync, openSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pruneScheduledBackups, scheduledBackupIsDue } from "../scheduled-backup";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tower-scheduled-backup-"));
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(name: string, ageHours: number) {
  const file = join(root, name);
  closeSync(openSync(file, "w"));
  const time = new Date(Date.now() - ageHours * 60 * 60 * 1_000);
  utimesSync(file, time, time);
}

describe("scheduled backup policy", () => {
  it("is due only when no recent archive exists", () => {
    expect(scheduledBackupIsDue(root, 24)).toBe(true);
    touch("tower-backup-20260729-010101.tar.gz", 2);
    expect(scheduledBackupIsDue(root, 24)).toBe(false);
    expect(scheduledBackupIsDue(root, 1)).toBe(true);
  });

  it("retains the newest automatic archives without deleting manual backups", () => {
    touch("tower-auto-20260726-010101.tar.gz", 72);
    touch("tower-auto-20260727-010101.tar.gz", 48);
    touch("tower-auto-20260728-010101.tar.gz", 24);
    touch("tower-backup-20260720-010101.tar.gz", 200);

    expect(pruneScheduledBackups(root, 2)).toEqual(["tower-auto-20260726-010101.tar.gz"]);
    expect(scheduledBackupIsDue(root, 1)).toBe(true);
  });
});
