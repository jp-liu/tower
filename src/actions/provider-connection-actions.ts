"use server";

/**
 * Provider connection state — recorded by /api/adapters/test on every probe.
 *
 * The capability slot system (resolveCliAdapter / resolveQueryAdapter) consults
 * these rows to decide which providers are usable. Untested → not selectable.
 *
 * See .notes/ai-provider-integration.md for the full lifecycle.
 */

import { db } from "@/lib/db";
import type { ProviderInstallReport } from "@/lib/ai/install-orchestrator";

export interface ProviderConnectionRow {
  provider: string;
  lastTestedAt: Date | null;
  testOk: boolean;
  version: string | null;
  mcpInstalled: boolean;
  hooksInstalled: boolean;
  skillsInstalled: boolean;
  installLog: string | null;
}

/**
 * Persist the result of a successful test+install. Called from /api/adapters/test.
 *
 * `report.ok` reflects the install pipeline; `testOk` reflects only the hello
 * probe — they're stored separately so the slot resolver can distinguish
 * "probe passed but install failed (still unusable)" from "probe failed".
 */
export async function markProviderConnected(
  provider: string,
  args: {
    version?: string | null;
    report?: ProviderInstallReport;
  } = {},
): Promise<void> {
  const report = args.report;
  const installLog = report ? JSON.stringify(report) : null;

  await db.providerConnection.upsert({
    where: { provider },
    create: {
      provider,
      lastTestedAt: new Date(),
      testOk: true,
      version: args.version ?? null,
      mcpInstalled: report?.mcp?.ok ?? false,
      hooksInstalled: report?.hooks?.ok ?? false,
      skillsInstalled: report?.skill?.ok ?? false,
      installLog,
    },
    update: {
      lastTestedAt: new Date(),
      testOk: true,
      version: args.version ?? null,
      mcpInstalled: report?.mcp?.ok ?? false,
      hooksInstalled: report?.hooks?.ok ?? false,
      skillsInstalled: report?.skill?.ok ?? false,
      installLog,
    },
  });
}

/**
 * Persist a failed test (or failed install). Capability slots will refuse to
 * use this provider until the user successfully tests again.
 */
export async function markProviderDisconnected(
  provider: string,
  args: { reason?: string } = {},
): Promise<void> {
  await db.providerConnection.upsert({
    where: { provider },
    create: {
      provider,
      lastTestedAt: new Date(),
      testOk: false,
      installLog: args.reason ?? null,
    },
    update: {
      lastTestedAt: new Date(),
      testOk: false,
      mcpInstalled: false,
      hooksInstalled: false,
      skillsInstalled: false,
      installLog: args.reason ?? null,
    },
  });
}

/**
 * "Connected" = the hello probe passed. We used to also require
 * `mcpInstalled && hooksInstalled && skillsInstalled`, but that's overkill:
 * a working CLI is enough to launch a terminal session, and on Windows the
 * skill symlink / hook write commonly fails for environmental reasons
 * (admin rights, AV interference) — those shouldn't lock the user out of
 * a CLI that otherwise works. The Settings UI still surfaces per-integration
 * install status so users see what's degraded.
 */
export async function isProviderConnected(provider: string): Promise<boolean> {
  const row = await db.providerConnection.findUnique({ where: { provider } });
  if (!row) return false;
  return row.testOk;
}

export async function getConnectedProviders(): Promise<string[]> {
  const rows = await db.providerConnection.findMany({
    where: { testOk: true },
    select: { provider: true },
    orderBy: { provider: "asc" },
  });
  return rows.map((r) => r.provider);
}

export async function getProviderConnection(provider: string): Promise<ProviderConnectionRow | null> {
  return db.providerConnection.findUnique({
    where: { provider },
    select: {
      provider: true,
      lastTestedAt: true,
      testOk: true,
      version: true,
      mcpInstalled: true,
      hooksInstalled: true,
      skillsInstalled: true,
      installLog: true,
    },
  });
}

/** All rows, for Settings UI to render status badges per provider. */
export async function getProviderConnections(): Promise<ProviderConnectionRow[]> {
  return db.providerConnection.findMany({
    select: {
      provider: true,
      lastTestedAt: true,
      testOk: true,
      version: true,
      mcpInstalled: true,
      hooksInstalled: true,
      skillsInstalled: true,
      installLog: true,
    },
    orderBy: { provider: "asc" },
  });
}
