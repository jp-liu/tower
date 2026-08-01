import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Workbench module boundaries", () => {
  it("keeps the PTY core independent from Workbench", () => {
    expect(source("src/lib/pty/pty-session.ts")).not.toContain("@/lib/workbench");
  });

  it("routes Gateway commands through the public Workbench inbox", () => {
    const gatewayRouter = source("src/lib/harness/gateway-router.ts");
    expect(gatewayRouter).toContain("@/lib/workbench/command-inbox");
    expect(gatewayRouter).not.toContain("@/lib/workbench/coordinator");
  });

  it("keeps Gateway-owned persistence out of the Workbench coordinator", () => {
    const coordinator = source("src/lib/workbench/coordinator.ts");
    expect(coordinator).not.toContain("db.gatewayInbound");
    expect(coordinator).not.toContain("@/lib/harness");
  });

  it("keeps operational observation inside each persistence owner", () => {
    const workbenchMaintenance = source("src/lib/workbench/maintenance.ts");
    expect(workbenchMaintenance).not.toMatch(/Gateway(Inbound|Delivery|TaskLink)/);
    expect(workbenchMaintenance).not.toContain("@/lib/harness");

    const gatewayMaintenance = source("src/lib/harness/gateway-maintenance.ts");
    expect(gatewayMaintenance).not.toMatch(/Workbench(Event|Batch|Runtime)/);
    expect(gatewayMaintenance).not.toContain("@/lib/workbench");
  });
});
