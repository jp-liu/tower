import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { existsSync } from "fs";
import { testEnvironment, type TestResult, type TestCheck } from "@/lib/cli-test";
import { db } from "@/lib/db";
import {
  installAllForProvider,
  type ProviderInstallReport,
} from "@/lib/ai/install-orchestrator";
import { providerRegistry } from "@/lib/ai/providers";
import { testPluginCliConnection } from "@/lib/ai/cli-plugin-provider";
import { requireLocalhost } from "@/lib/internal-api-guard";
import {
  markProviderConnected,
  markProviderDisconnected,
} from "@/actions/provider-connection-actions";

export const runtime = "nodejs";

/** Pull the CLI version string out of the probe checks for telemetry. */
function extractVersion(checks: TestCheck[]): string | null {
  const versionCheck = checks.find((c) => c.name.endsWith("_version"));
  if (!versionCheck) return null;
  const match = versionCheck.message.match(/Version:\s*(.+)$/);
  return match ? match[1].trim() : null;
}

const bodySchema = z.object({
  adapterType: z.string().optional(),
  provider: z.string().optional(),
  cwd: z.string().optional(),
});

export interface TestAndInstallResult extends TestResult {
  /** Set when test passed AND we attempted installation. */
  install?: ProviderInstallReport;
}

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
    }

    const { cwd, provider } = parsed.data;

    // Validate cwd: must be an existing project localPath or use process.cwd()
    let resolvedCwd = process.cwd();
    if (cwd) {
      const project = await db.project.findFirst({ where: { localPath: cwd } });
      if (!project) {
        return NextResponse.json(
          { ok: false, error: "cwd must be a registered project local path" },
          { status: 400 }
        );
      }
      if (!existsSync(cwd)) {
        return NextResponse.json(
          { ok: false, error: "cwd directory does not exist" },
          { status: 400 }
        );
      }
      resolvedCwd = cwd;
    }

    // Pre-flight: rewrite any stale Tower hook paths in the provider's
    // settings file. Older versions (0.2.5/0.2.6) wrote `.next/standalone/
    // scripts/*.js` paths that don't exist on the user's disk; if we let the
    // hello probe run against those, Claude on Windows hangs after
    // `hook_started` and the probe never reaches the install step below
    // (which is where the upsert would normally fix it). Repair-only: no new
    // hook entries are added.
    if (provider) {
      try {
        const definition = providerRegistry.get(provider);
        const manifest = definition?.cli?.plugin.manifest;
        if (definition?.builtin
          && manifest?.capabilities.integrations?.hooks === true
          && manifest.permissions.includes("integration:hooks")) {
          await definition.cli?.adapter.hooks?.install({ repairOnly: true });
        }
      } catch {
        // Best-effort — proceed with the probe even if repair fails.
      }
    }

    let testResult: TestResult;
    if (provider && !providerRegistry.get(provider)) {
      try {
        const probe = await testPluginCliConnection(provider);
        testResult = {
          ok: true,
          checks: [
            { name: `${provider}_command_resolvable`, passed: true, message: "CLI command found and runnable" },
            { name: `${provider}_version`, passed: true, message: `Version: ${probe.version ?? "unknown"}` },
            { name: `${provider}_hello`, passed: true, message: "Hello probe passed" },
          ],
        };
      } catch (error) {
        testResult = {
          ok: false,
          checks: [{
            name: `${provider}_hello`,
            passed: false,
            message: error instanceof Error ? error.message : "probe_failed",
          }],
        };
      }
    } else {
      testResult = await testEnvironment(resolvedCwd, provider);
    }

    // On a successful probe, run the integration installer (MCP via CLI, hooks
    // via file, skill via symlink) AND record the outcome to ProviderConnection
    // so capability slots can gate selection on this row. This replaces the old
    // startup-time auto-injection — see .notes/ai-provider-integration.md.
    let install: ProviderInstallReport | undefined;
    if (provider) {
      if (testResult.ok) {
        try {
          const apiUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;
          install = await installAllForProvider(provider, apiUrl);
          await markProviderConnected(provider, {
            version: extractVersion(testResult.checks),
            report: install,
          });
        } catch (err) {
          install = {
            provider,
            available: true,
            ok: false,
            mcp: undefined,
            hooks: undefined,
            skill: undefined,
          } as ProviderInstallReport;
          console.error(
            "[adapters/test] install error:",
            providerRegistry.get(provider) ? err : "third-party integration failed",
          );
          // The Hello Probe already succeeded. Integration failures are a
          // degraded connection, not a disconnected CLI.
          await markProviderConnected(provider, {
            version: extractVersion(testResult.checks),
            report: install,
          });
        }
      } else {
        // Probe failed — make sure the slot system can't pick this provider.
        const failedCheck = testResult.checks.find((c) => !c.passed && !c.name.endsWith("_api_key"));
        await markProviderDisconnected(provider, {
          reason: failedCheck?.message ?? "test failed",
        });
      }
    }

    const response: TestAndInstallResult = { ...testResult, install };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ adapters: ["claude_local"] });
}
