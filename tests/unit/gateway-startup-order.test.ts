// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("gateway recovery startup ordering", () => {
  it("completes schema and data migrations before the Next.js server can run recovery", async () => {
    const launcher = await readFile(join(process.cwd(), "bin/tower.mjs"), "utf8");
    const preStart = launcher.indexOf("await preStart();");
    const serverImport = launcher.indexOf("await import(pathToFileURL(standaloneServer).href);");
    expect(preStart).toBeGreaterThan(-1);
    expect(serverImport).toBeGreaterThan(preStart);

    const preStartBody = launcher.slice(
      launcher.indexOf("async function preStart()"),
      launcher.indexOf("function runPendingMigrations()"),
    );
    expect(preStartBody.indexOf("ensureSchemaCurrent()"))
      .toBeLessThan(preStartBody.indexOf("runPendingMigrations()"));

    const migrationRunner = await readFile(join(process.cwd(), "scripts/run-migrations.ts"), "utf8");
    expect(migrationRunner).toContain("if (failure) throw failure");

    const instrumentation = await readFile(join(process.cwd(), "src/lib/instrumentation-tasks.ts"), "utf8");
    expect(instrumentation).toContain("retryGatewayDeliveries()");
  });

  it("composes operational observation into the existing six-hour sweep", async () => {
    const instrumentation = await readFile(join(process.cwd(), "src/instrumentation-node.ts"), "utf8");
    const sweep = instrumentation.slice(
      instrumentation.indexOf("const gSweep"),
      instrumentation.indexOf("const gBackup"),
    );
    expect(sweep).toContain("measureWorkbenchOperationalData");
    expect(sweep).toContain("measureGatewayOperationalData");
    expect(sweep.match(/setInterval\(/g)).toHaveLength(1);
    expect(sweep).toContain("6 * 60 * 60 * 1000");
  });
});
