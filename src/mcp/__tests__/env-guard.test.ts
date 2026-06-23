import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveTowerDataDir } from "../env-guard";

describe("resolveTowerDataDir", () => {
  it("respects an already-pinned TOWER_DATA_DIR (registration wins over .env)", () => {
    expect(
      resolveTowerDataDir({
        TOWER_DATA_DIR: "/Users/me/.tower",
        DATABASE_URL: "file:/Users/me/.tower-dev/database/tower.db",
      })
    ).toBe("/Users/me/.tower");
  });

  it("derives the prod data dir from a prod DATABASE_URL when TOWER_DATA_DIR is unset", () => {
    // This is the feishu-bot leak case: DATABASE_URL pinned to prod, but
    // TOWER_DATA_DIR unset would otherwise be injected as ~/.tower-dev by the
    // repo's .env. Deriving from the DB keeps assets in the prod data dir.
    expect(
      resolveTowerDataDir({
        DATABASE_URL: "file:/Users/me/.tower/database/tower.db",
      })
    ).toBe("/Users/me/.tower");
  });

  it("derives the dev data dir from a dev DATABASE_URL (dev stays dev)", () => {
    expect(
      resolveTowerDataDir({
        DATABASE_URL: "file:/Users/me/.tower-dev/database/tower.db",
      })
    ).toBe("/Users/me/.tower-dev");
  });

  it("falls back to ~/.tower when neither var is set", () => {
    expect(resolveTowerDataDir({})).toBe(join(homedir(), ".tower"));
  });

  it("falls back to ~/.tower for a non-file DATABASE_URL", () => {
    expect(
      resolveTowerDataDir({ DATABASE_URL: "postgresql://localhost/db" })
    ).toBe(join(homedir(), ".tower"));
  });
});
