import "server-only";

import { capabilityError } from "@tower-org/ai-runtime";
import type { CliSessionOptions } from "@tower-org/ai-sdk";
import { db } from "@/lib/db";
import {
  resolveFixedCliConnection,
  resolveLegacyExecutionCliConnection,
  type ResolvedCapabilityTarget,
} from "./capability-resolver";
import {
  mergeProviderProcess,
  profileForProvider,
  terminalBaseEnvironment,
  type LegacyCliProfileOverrides,
} from "./provider-host";

export interface TerminalTargetSnapshot {
  connectionId: string;
  modelId: string | null;
  targetId: string;
}

export interface TerminalExecutionBinding {
  id: string;
  agent: string;
  connectionId: string | null;
  modelId: string | null;
  targetId: string | null;
}

export interface TerminalLaunch {
  processSpec: ReturnType<NonNullable<ResolvedCapabilityTarget["cli"]>["adapter"]["buildSessionProcess"]>;
  envOverrides: Record<string, string>;
  baseEnv: Record<string, string>;
  adapter: NonNullable<ResolvedCapabilityTarget["cli"]>["adapter"];
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function parseStringRecord(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

async function loadLegacyCliProfile(): Promise<LegacyCliProfileOverrides> {
  const cliProfile = (db as typeof db & { cliProfile?: typeof db.cliProfile }).cliProfile;
  if (!cliProfile) return {};
  const profile = await cliProfile.findFirst({ where: { isDefault: true } });
  if (!profile) return {};
  return {
    command: profile.command.trim() || undefined,
    baseArgs: parseStringArray(profile.baseArgs),
    envPatch: parseStringRecord(profile.envVars),
  };
}

export function terminalTargetSnapshot(target: ResolvedCapabilityTarget): TerminalTargetSnapshot {
  return {
    connectionId: target.connectionId,
    modelId: target.modelId ?? null,
    targetId: target.targetId,
  };
}

export function requireUsableTerminalTarget(
  target: ResolvedCapabilityTarget,
): asserts target is ResolvedCapabilityTarget & { cli: NonNullable<ResolvedCapabilityTarget["cli"]> } {
  if (target.preflightError) throw capabilityError(target.preflightError.code);
  if (target.kind !== "cli" || !target.cli) throw capabilityError("connection_unavailable");
}

export async function resolveExecutionTerminalTarget(
  execution: TerminalExecutionBinding,
  cwd: string,
): Promise<ResolvedCapabilityTarget> {
  const target = execution.connectionId
    ? await resolveFixedCliConnection(execution.connectionId, execution.modelId, {
        cwd,
        targetId: execution.targetId,
      })
    : await resolveLegacyExecutionCliConnection(execution.agent, {
        cwd,
        targetId: execution.targetId,
      });
  requireUsableTerminalTarget(target);

  if (!execution.connectionId) {
    const snapshot = terminalTargetSnapshot(target);
    await db.taskExecution.update({
      where: { id: execution.id },
      data: snapshot,
    });
  }
  return target;
}

export async function buildTerminalLaunch(
  target: ResolvedCapabilityTarget,
  options: CliSessionOptions,
): Promise<TerminalLaunch> {
  requireUsableTerminalTarget(target);
  const legacyProfile = target.cli.provider.builtin === true
    ? profileForProvider(await loadLegacyCliProfile(), target.cli.provider.cli!.plugin)
    : {};
  const processSpec = mergeProviderProcess(
    target.cli.adapter.buildSessionProcess(options),
    legacyProfile.command ?? target.cli.commandPath,
    legacyProfile,
  );
  return {
    processSpec,
    envOverrides: Object.fromEntries(
      Object.entries(processSpec.envPatch ?? {})
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    baseEnv: terminalBaseEnvironment(),
    adapter: target.cli.adapter,
  };
}
