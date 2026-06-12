// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";

// We need to control what tower-dir returns so getTowerMcpName branches.
vi.mock("@/lib/tower-dir", () => ({
  getTowerDir: vi.fn(),
  getTowerDbPath: vi.fn(() => "/dev/null"),
}));

import { getTowerMcpName } from "../install-orchestrator";
import { getTowerDir } from "@/lib/tower-dir";

const mockGetTowerDir = vi.mocked(getTowerDir);

describe("getTowerMcpName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'tower' for the canonical ~/.tower path", () => {
    mockGetTowerDir.mockReturnValue(path.join(os.homedir(), ".tower"));
    expect(getTowerMcpName()).toBe("tower");
  });

  it("returns 'tower-dev' for ~/.tower-dev", () => {
    mockGetTowerDir.mockReturnValue(path.join(os.homedir(), ".tower-dev"));
    expect(getTowerMcpName()).toBe("tower-dev");
  });

  it("returns 'tower-staging' for ~/.tower-staging", () => {
    mockGetTowerDir.mockReturnValue(path.join(os.homedir(), ".tower-staging"));
    expect(getTowerMcpName()).toBe("tower-staging");
  });

  it("strips leading dot when path basename is .tower-foo (not under home)", () => {
    mockGetTowerDir.mockReturnValue("/opt/.tower-prod");
    expect(getTowerMcpName()).toBe("tower-prod");
  });

  it("falls back to sanitized basename for non-conforming dir names", () => {
    mockGetTowerDir.mockReturnValue("/srv/Custom Path/my data!");
    expect(getTowerMcpName()).toBe("tower-my-data-");
  });

  it("lowercases the suffix", () => {
    mockGetTowerDir.mockReturnValue(path.join(os.homedir(), ".tower-DEV"));
    expect(getTowerMcpName()).toBe("tower-dev");
  });
});
