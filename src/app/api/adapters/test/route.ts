import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { existsSync } from "fs";
import { testEnvironment, type TestResult } from "@/lib/cli-test";
import { db } from "@/lib/db";
import {
  type ProviderInstallReport,
} from "@/lib/ai/install-orchestrator";
import { reconcileProviderIntegrations } from "@/lib/ai/provider-reconciliation";
import { providerRegistry } from "@/lib/ai/providers";
import { testPluginCliConnection } from "@/lib/ai/cli-plugin-provider";
import { requireLocalhost } from "@/lib/internal-api-guard";
import {
  markProviderDisconnected,
} from "@/actions/provider-connection-actions";

export const runtime = "nodejs";

const bodySchema = z.object({
  adapterType: z.string().optional(),
  provider: z.string().trim().min(1),
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

    // Version-check and repair Tower-owned integrations before the connection
    // test owns the Hello probe. This also replaces the old static-only Hook
    // preflight and keeps incompatible/missing CLIs free of config writes.
    if (provider) {
      try {
        await reconcileProviderIntegrations({
          provider,
          trigger: "hello-success",
          apiUrl: `${request.nextUrl.protocol}//${request.nextUrl.host}`,
          cwd: resolvedCwd,
          skipHello: true,
        });
      } catch {
        // The test below still returns its normal dependency/Hello diagnostics.
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
      } catch {
        testResult = {
          ok: false,
          checks: [{
            name: `${provider}_hello`,
            passed: false,
            message: "Third-party CLI connection test failed",
          }],
        };
      }
    } else {
      testResult = await testEnvironment(resolvedCwd, provider);
    }

    // A successful Hello finalizes the preflight reconciliation cache so
    // capability slots can select this exact connection.
    let install: ProviderInstallReport | undefined;
    if (provider) {
      if (testResult.ok) {
        try {
          const apiUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;
          const reconciliation = await reconcileProviderIntegrations({
            provider,
            trigger: "hello-success",
            apiUrl,
            cwd: resolvedCwd,
            helloAlreadySucceeded: true,
          });
          install = reconciliation.report;
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
        }
      } else {
        // Probe failed — make sure the slot system can't pick this provider.
        const failedCheck = testResult.checks.find((c) => !c.passed && !c.name.endsWith("_api_key"));
        const dependencyFailure = failedCheck?.name.endsWith("_command_resolvable")
          || failedCheck?.name.endsWith("_version_compatibility");
        const cached = await db.providerConnection.findUnique({
          where: { connectionKey: `cli:${provider}` },
          select: { testStatus: true },
        });
        if (dependencyFailure) {
          await reconcileProviderIntegrations({
            provider,
            trigger: "dependency-changed",
            cwd: resolvedCwd,
          });
        } else if (cached?.testStatus !== "dependency-missing"
          && cached?.testStatus !== "dependency-incompatible") {
          await markProviderDisconnected(provider, {
            reason: failedCheck?.message ?? "test failed",
          });
        }
      }
    }

    const response: TestAndInstallResult = { ...testResult, install };
    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { ok: false, error: "connection_test_failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ adapters: ["claude_local"] });
}
