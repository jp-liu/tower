import "server-only";

import {
  ControlledProcessExecutor,
  capabilityError,
  stableJson,
  type CapabilityErrorShape,
} from "@tower-org/ai-runtime";
import { db } from "@/lib/db";
import { getPackageRoot } from "@/lib/tower-paths";
import {
  inspectResolvedProviderIntegration,
  reconcileResolvedProviderIntegrations,
  type ProviderInstallReport,
  type ProviderIntegrationStatus,
} from "./install-orchestrator";
import { providerBaseEnvironment } from "./provider-host";
import { providerRegistry } from "./providers";
import type { CliPluginConnectionRecord } from "./cli-plugin-provider";

export type ProviderReconciliationTrigger =
  | "startup"
  | "extension-enabled"
  | "hello-success"
  | "terminal-spawn"
  | "dependency-changed"
  | "manual-repair";

export type ProviderReconciliationStatus =
  | "connected"
  | "partial"
  | "dependency-missing"
  | "dependency-incompatible"
  | "permission-required"
  | "plugin-disabled"
  | "plugin-uninstalled"
  | "failed";

export interface ProviderReconciliationResult {
  provider: string;
  connectionId: string | null;
  trigger: ProviderReconciliationTrigger;
  reconciledAt: string;
  status: ProviderReconciliationStatus;
  available: boolean;
  commandPath: string | null;
  cliVersion: string | null;
  fingerprint: string | null;
  hello: "passed" | "failed" | "preserved" | "not-run";
  integrations: ProviderIntegrationStatus;
  report?: ProviderInstallReport;
  diagnosticCode: string;
  attempts: number;
}

interface ReconcileOptions {
  provider?: string;
  connectionId?: string;
  trigger: ProviderReconciliationTrigger;
  cwd?: string;
  apiUrl?: string;
  helloAlreadySucceeded?: boolean;
  /** Internal connection-test preflight: repair integrations before that test owns the Hello probe. */
  skipHello?: boolean;
  attempt?: number;
}

const queueTails = new Map<string, Promise<void>>();
const equivalentRequests = new Map<string, Promise<ProviderReconciliationResult>>();

function towerApiUrl(): string {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  return `http://localhost:${Number.isFinite(port) ? port : 3000}`;
}

function emptyIntegrations(): ProviderIntegrationStatus {
  return { mcpInstalled: false, hooksInstalled: false, skillsInstalled: false, ok: false };
}

const connectionSelect = {
  id: true,
  provider: true,
  enabled: true,
  testStatus: true,
  testOk: true,
  lastTestedAt: true,
  commandOverride: true,
  baseArgsJson: true,
  envVarsJson: true,
  settingsJson: true,
  resolvedCommand: true,
  resolvedVersion: true,
} as const;

type ReconciliationConnection = Awaited<ReturnType<typeof loadConnection>>;

async function loadConnection(options: ReconcileOptions) {
  if (options.connectionId) {
    return db.providerConnection.findUnique({ where: { id: options.connectionId }, select: connectionSelect });
  }
  if (!options.provider) return null;
  return db.providerConnection.findUnique({
    where: { connectionKey: `cli:${options.provider}` },
    select: connectionSelect,
  });
}

function resolutionFailure(error: unknown): {
  status: ProviderReconciliationStatus;
  code: string;
} {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("not found") || message.includes("not runnable")
    || message === "cli_not_found" || message === "cli_not_executable") {
    return { status: "dependency-missing", code: "dependency_missing" };
  }
  if (message.includes("incompatible") || message === "cli_dependency_incompatible") {
    return { status: "dependency-incompatible", code: "dependency_incompatible" };
  }
  if (message === "plugin_disabled" || message === "plugin-disabled") {
    return { status: "plugin-disabled", code: "plugin_disabled" };
  }
  if (message === "plugin_not_found" || message === "plugin-uninstalled") {
    return { status: "plugin-uninstalled", code: "plugin_not_found" };
  }
  if (message.includes("permission")) return { status: "permission-required", code: "permission_required" };
  return { status: "failed", code: "provider_resolution_failed" };
}

async function persistUnavailable(
  provider: string,
  connection: ReconciliationConnection,
  result: ProviderReconciliationResult,
): Promise<void> {
  const data = {
    testStatus: result.status,
    testOk: false,
    mcpInstalled: false,
    hooksInstalled: false,
    skillsInstalled: false,
    installLog: JSON.stringify(result),
    diagnosticsJson: JSON.stringify({
      code: result.diagnosticCode,
      trigger: result.trigger,
      reconciledAt: result.reconciledAt,
    }),
  };
  if (connection) {
    await db.providerConnection.update({ where: { id: connection.id }, data });
    return;
  }
  if (!providerRegistry.get(provider)?.cli) return;
  await db.providerConnection.upsert({
    where: { connectionKey: `cli:${provider}` },
    create: {
      connectionKey: `cli:${provider}`,
      name: providerRegistry.get(provider)?.displayName ?? provider,
      kind: "cli",
      provider,
      enabled: true,
      ...data,
    },
    update: data,
  });
}

async function runHelloProbe(
  provider: string,
  commandPath: string,
  cwd: string,
  adapter: NonNullable<Awaited<ReturnType<typeof providerRegistry.createResolvedCliAdapter>>>["adapter"],
): Promise<boolean> {
  if (!adapter.buildHelloProbe) return false;
  try {
    const processSpec = adapter.buildHelloProbe({
      command: commandPath,
      cwd,
      prompt: "Respond with just the word hello",
    });
    const result = await new ControlledProcessExecutor({
      env: providerBaseEnvironment(provider),
    }).execute(processSpec, { timeoutMs: 45_000, maxOutputBytes: 4 * 1024 * 1024 });
    return result.exitCode === 0 && `${result.stdout}${result.stderr}`.trim().length > 0;
  } catch {
    return false;
  }
}

async function ensureEligible(provider: string): Promise<ProviderReconciliationStatus | null> {
  if (providerRegistry.get(provider)?.cli) return null;
  const registered = (await providerRegistry.listCliProviders()).find((entry) => entry.id === provider);
  if (registered) return null;
  const installed = (await getCliPluginState(provider));
  if (!installed) return "plugin-uninstalled";
  if (!installed.permissionConfirmed) return "permission-required";
  return "plugin-disabled";
}

async function getCliPluginState(provider: string) {
  try {
    return (await import("./cli-plugin-service")).getCliPluginApplication().list()
      .then((plugins) => plugins.find((plugin) => plugin.id === provider) ?? null);
  } catch {
    return null;
  }
}

async function reconcileProviderOnce(options: ReconcileOptions): Promise<ProviderReconciliationResult> {
  const connection = await loadConnection(options);
  const provider = options.provider ?? connection?.provider;
  if (!provider) throw new Error("Provider or connectionId is required");
  const reconciledAt = new Date().toISOString();
  if (connection?.enabled === false) {
    return {
      provider,
      connectionId: connection.id,
      trigger: options.trigger,
      reconciledAt,
      status: "plugin-disabled",
      available: false,
      commandPath: connection.resolvedCommand,
      cliVersion: connection.resolvedVersion,
      fingerprint: null,
      hello: "not-run",
      integrations: emptyIntegrations(),
      diagnosticCode: "connection_disabled",
      attempts: options.attempt ?? 1,
    };
  }
  const ineligible = await ensureEligible(provider);
  if (ineligible) {
    const result: ProviderReconciliationResult = {
      provider,
      connectionId: connection?.id ?? null,
      trigger: options.trigger,
      reconciledAt,
      status: ineligible,
      available: false,
      commandPath: null,
      cliVersion: null,
      fingerprint: null,
      hello: "not-run",
      integrations: emptyIntegrations(),
      diagnosticCode: ineligible.replaceAll("-", "_"),
      attempts: options.attempt ?? 1,
    };
    await persistUnavailable(provider, connection, result);
    return result;
  }

  let resolved;
  try {
    resolved = connection
      ? await providerRegistry.createResolvedCliConnectionAdapter(
          connection as CliPluginConnectionRecord,
          options.cwd ?? getPackageRoot(),
        )
      : await providerRegistry.createResolvedCliAdapter(provider, options.cwd ?? getPackageRoot());
    if (!resolved) throw new Error("cli_not_found");
  } catch (error) {
    const failure = resolutionFailure(error);
    const result: ProviderReconciliationResult = {
      provider,
      connectionId: connection?.id ?? null,
      trigger: options.trigger,
      reconciledAt,
      status: failure.status,
      available: false,
      commandPath: null,
      cliVersion: null,
      fingerprint: null,
      hello: "not-run",
      integrations: emptyIntegrations(),
      diagnosticCode: failure.code,
      attempts: options.attempt ?? 1,
    };
    await persistUnavailable(provider, connection, result);
    return result;
  }

  const report = await reconcileResolvedProviderIntegrations(
    resolved,
    options.apiUrl ?? towerApiUrl(),
  );
  const pathChanged = connection?.resolvedCommand !== null
    && connection?.resolvedCommand !== resolved.commandPath;
  const versionChanged = connection?.resolvedVersion !== null
    && connection?.resolvedVersion !== resolved.version;
  const shouldRunHello = options.skipHello !== true
    && options.helloAlreadySucceeded !== true
    && (!connection?.testOk || pathChanged || versionChanged
      || options.trigger === "extension-enabled"
      || options.trigger === "manual-repair"
      || options.trigger === "dependency-changed");
  const helloPassed = options.helloAlreadySucceeded === true
    || (shouldRunHello && await runHelloProbe(provider, resolved.commandPath, options.cwd ?? getPackageRoot(), resolved.adapter));
  const preservedHello = !shouldRunHello && options.helloAlreadySucceeded !== true && connection?.testOk === true;
  const testOk = helloPassed || preservedHello;
  const helloPending = options.skipHello === true && !testOk;
  const status: ProviderReconciliationStatus = helloPending
    ? report.ok ? "partial" : "failed"
    : !testOk
    ? "failed"
    : report.ok ? "connected" : "partial";
  const integrations = {
    mcpInstalled: report.desired?.mcp ? report.mcp?.ok === true : false,
    hooksInstalled: report.desired?.hooks ? report.hooks?.ok === true : false,
    skillsInstalled: report.desired?.skills ? report.skill?.ok === true : false,
    ok: report.ok,
  };
  const result: ProviderReconciliationResult = {
    provider,
    connectionId: connection?.id ?? resolved.connectionId,
    trigger: options.trigger,
    reconciledAt: report.reconciledAt ?? reconciledAt,
    status,
    available: true,
    commandPath: resolved.commandPath,
    cliVersion: resolved.version,
    fingerprint: report.integrationFingerprint ?? null,
    hello: options.helloAlreadySucceeded ? "passed"
      : shouldRunHello ? helloPassed ? "passed" : "failed"
        : preservedHello ? "preserved" : "not-run",
    integrations,
    report,
    diagnosticCode: helloPending
      ? report.ok ? "hello_pending" : "integration_repair_failed"
      : !testOk ? "hello_probe_failed" : report.ok ? "ok" : "integration_repair_failed",
    attempts: options.attempt ?? 1,
  };
  const data = {
    testStatus: status,
    testOk,
    ...(helloPassed || shouldRunHello ? { lastTestedAt: new Date() } : {}),
    version: resolved.version,
    resolvedCommand: resolved.commandPath,
    resolvedVersion: resolved.version,
    mcpInstalled: integrations.mcpInstalled,
    hooksInstalled: integrations.hooksInstalled,
    skillsInstalled: integrations.skillsInstalled,
    installLog: JSON.stringify(result),
    diagnosticsJson: JSON.stringify({
      code: result.diagnosticCode,
      trigger: result.trigger,
      reconciledAt: result.reconciledAt,
      fingerprint: result.fingerprint,
    }),
  };
  if (connection) {
    await db.providerConnection.update({ where: { id: connection.id }, data });
  } else {
    await db.providerConnection.upsert({
      where: { connectionKey: `cli:${provider}` },
      create: {
        connectionKey: `cli:${provider}`,
        name: resolved.provider.displayName,
        kind: "cli",
        provider,
        enabled: true,
        ...data,
      },
      update: data,
    });
  }
  return result;
}

export function reconcileProviderIntegrations(
  options: ReconcileOptions,
): Promise<ProviderReconciliationResult> {
  return enqueueReconciliation(options);
}

async function reconciliationQueueKey(options: ReconcileOptions): Promise<string> {
  if (options.connectionId) return `connection:${options.connectionId}`;
  if (!options.provider) throw new Error("Provider or connectionId is required");
  const connection = await loadConnection(options);
  return connection ? `connection:${connection.id}` : `provider:${options.provider}`;
}

function reconciliationRequestSignature(options: ReconcileOptions): string {
  return stableJson({
    provider: options.provider ?? null,
    connectionId: options.connectionId ?? null,
    trigger: options.trigger,
    cwd: options.cwd ?? getPackageRoot(),
    apiUrl: options.apiUrl ?? towerApiUrl(),
    skipHello: options.skipHello === true,
    helloAlreadySucceeded: options.helloAlreadySucceeded === true,
  });
}

async function runReconciliationWithRetry(
  options: ReconcileOptions,
): Promise<ProviderReconciliationResult> {
  const result = await reconcileProviderOnce(options);
  if (result.diagnosticCode === "integration_repair_failed") {
    return reconcileProviderOnce({ ...options, attempt: 2 });
  }
  return result;
}

async function enqueueReconciliation(
  options: ReconcileOptions,
): Promise<ProviderReconciliationResult> {
  const queueKey = await reconciliationQueueKey(options);
  const equivalentKey = `${queueKey}\n${reconciliationRequestSignature(options)}`;
  const equivalent = equivalentRequests.get(equivalentKey);
  if (equivalent) return equivalent;

  const previous = queueTails.get(queueKey) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(() => runReconciliationWithRetry(options));
  const tail = operation.then(() => undefined, () => undefined);
  queueTails.set(queueKey, tail);
  equivalentRequests.set(equivalentKey, operation);

  const cleanup = () => {
    if (equivalentRequests.get(equivalentKey) === operation) {
      equivalentRequests.delete(equivalentKey);
    }
    if (queueTails.get(queueKey) === tail) queueTails.delete(queueKey);
  };
  void operation.then(cleanup, cleanup);
  return operation;
}

export async function inspectProviderIntegrations(input: {
  provider?: string;
  connectionId?: string;
  cwd?: string;
}): Promise<ProviderReconciliationResult> {
  const connection = await loadConnection({ ...input, trigger: "manual-repair" });
  const provider = input.provider ?? connection?.provider;
  if (!provider) throw new Error("Provider or connectionId is required");
  const reconciledAt = new Date().toISOString();
  try {
    const ineligible = await ensureEligible(provider);
    if (ineligible) throw new Error(ineligible);
    const resolved = connection
      ? await providerRegistry.createResolvedCliConnectionAdapter(
          connection as CliPluginConnectionRecord,
          input.cwd ?? getPackageRoot(),
        )
      : await providerRegistry.createResolvedCliAdapter(provider, input.cwd ?? getPackageRoot());
    if (!resolved) throw new Error("cli_not_found");
    const inspection = await inspectResolvedProviderIntegration(resolved);
    const integrations = {
      mcpInstalled: inspection.mcpInstalled,
      hooksInstalled: inspection.hooksInstalled,
      skillsInstalled: inspection.skillsInstalled,
      ok: inspection.ok,
    };
    return {
      provider,
      connectionId: connection?.id ?? resolved.connectionId,
      trigger: "manual-repair",
      reconciledAt,
      status: integrations.ok ? "connected" : "partial",
      available: true,
      commandPath: resolved.commandPath,
      cliVersion: resolved.version,
      fingerprint: null,
      hello: "not-run",
      integrations,
      diagnosticCode: integrations.ok ? "ok" : "integration_missing",
      attempts: 1,
    };
  } catch (error) {
    const failure = resolutionFailure(error);
    return {
      provider,
      connectionId: connection?.id ?? null,
      trigger: "manual-repair",
      reconciledAt,
      status: failure.status,
      available: false,
      commandPath: null,
      cliVersion: null,
      fingerprint: null,
      hello: "not-run",
      integrations: emptyIntegrations(),
      diagnosticCode: failure.code,
      attempts: 1,
    };
  }
}

export async function reconcileAllProviderIntegrations(
  trigger: ProviderReconciliationTrigger,
): Promise<ProviderReconciliationResult[]> {
  const providers = await providerRegistry.listCliProviders();
  return Promise.all(providers.map(async (provider) => {
    try {
      return await reconcileProviderIntegrations({
        provider: provider.id,
        ...(provider.connectionId ? { connectionId: provider.connectionId } : {}),
        trigger,
      });
    } catch {
      return {
        provider: provider.id,
        connectionId: provider.connectionId,
        trigger,
        reconciledAt: new Date().toISOString(),
        status: "failed" as const,
        available: false,
        commandPath: null,
        cliVersion: null,
        fingerprint: null,
        hello: "not-run" as const,
        integrations: emptyIntegrations(),
        diagnosticCode: "reconciliation_failed",
        attempts: 1,
      };
    }
  }));
}

function terminalReconciliationError(
  status: ProviderReconciliationStatus,
): CapabilityErrorShape | null {
  if (status === "connected") return null;
  const code = status === "dependency-missing" || status === "plugin-uninstalled"
    ? "cli_not_found"
    : status === "plugin-disabled" || status === "permission-required"
      ? "connection_disabled"
      : "connection_unavailable";
  const error = capabilityError(code);
  return { code: error.code, message: error.message };
}

export async function reconcileTerminalCapabilityTargets(
  cwd: string,
): Promise<Map<string, CapabilityErrorShape>> {
  const failures = new Map<string, CapabilityErrorShape>();
  const config = await db.aiCapabilityConfig.findUnique({
    where: { slot: "terminal" },
    select: {
      targets: {
        orderBy: { order: "asc" },
        select: {
          connection: { select: { id: true, provider: true, kind: true, enabled: true } },
        },
      },
    },
  });
  for (const target of config?.targets ?? []) {
    if (target.connection.kind !== "cli") continue;
    if (!target.connection.enabled) {
      failures.set(target.connection.id, terminalReconciliationError("plugin-disabled")!);
      continue;
    }
    try {
      const result = await reconcileProviderIntegrations({
        provider: target.connection.provider,
        connectionId: target.connection.id,
        trigger: "terminal-spawn",
        cwd,
      });
      const failure = terminalReconciliationError(result.status);
      if (failure) failures.set(target.connection.id, failure);
    } catch {
      failures.set(target.connection.id, terminalReconciliationError("failed")!);
    }
  }
  return failures;
}

export async function reconcileTerminalExecutionBinding(
  binding: { connectionId: string | null; agent: string },
  cwd: string,
): Promise<void> {
  let result: ProviderReconciliationResult | null = null;
  if (binding.connectionId) {
    try {
      result = await reconcileProviderIntegrations({
        connectionId: binding.connectionId,
        trigger: "terminal-spawn",
        cwd,
      });
    } catch {
      throw capabilityError("connection_unavailable");
    }
  } else {
    const provider = providerRegistry.getByAgentFieldValue(binding.agent);
    if (provider?.cli) {
      try {
        result = await reconcileProviderIntegrations({
          provider: provider.name,
          trigger: "terminal-spawn",
          cwd,
        });
      } catch {
        throw capabilityError("connection_unavailable");
      }
    }
  }
  if (!result) return;
  const failure = terminalReconciliationError(result.status);
  if (failure) throw capabilityError(failure.code);
}
