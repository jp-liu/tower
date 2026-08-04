import "server-only";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { readHarnessGatewayRuntimeConfig } from "./gateway-config";

const log = logger.create("gateway-owner");

export const GATEWAY_CHANNEL_ACCESS_CONFIG_KEY = "tower-agent.channel-access.v1";
export const GATEWAY_CHANNEL_ACCESS_VERSION = 1 as const;

export type GatewayChannelScope =
  | { mode: "ALL" }
  | { mode: "WORKSPACE"; workspaceId: string }
  | { mode: "PROJECTS"; projectIds: string[] };

export interface GatewayChannelAccessRecord {
  gateway: string;
  platform: string;
  chatId: string;
  chatName?: string;
  status: "AUTHORIZED" | "REVOKED";
  scope: GatewayChannelScope;
  authorizedBy: string;
  authorizedAt: string;
  updatedBy: string;
  updatedAt: string;
  revokedBy?: string;
  revokedAt?: string;
  revision: number;
}

export interface GatewayChannelMutationReceipt {
  inboundId: string;
  action: GatewayChannelAccessAction;
  actorId: string;
  processedAt: string;
  channelKey: string;
  record: GatewayChannelAccessRecord;
}

export interface GatewayChannelAccessConfig {
  version: typeof GATEWAY_CHANNEL_ACCESS_VERSION;
  revision: number;
  channels: Record<string, GatewayChannelAccessRecord>;
  mutationReceipts: Record<string, GatewayChannelMutationReceipt>;
}

export type GatewayChannelAccessAction =
  | "authorize"
  | "bind_workspace"
  | "bind_projects"
  | "unbind"
  | "revoke"
  | "get";

export type GatewayChannelDecision =
  | { role: "OWNER"; allowed: true; scope: { mode: "ALL" } }
  | {
      role: "NON_OWNER";
      allowed: false;
      reason: "CHANNEL_UNAUTHORIZED" | "CHANNEL_REVOKED" | "SCOPE_INVALID";
    }
  | { role: "NON_OWNER"; allowed: true; scope: GatewayChannelScope };

export interface GatewayChannelAccessView extends GatewayChannelAccessRecord {
  key: string;
  scopeValid: boolean;
  workspace: { id: string; name: string } | null;
  projects: Array<{
    id: string;
    name: string;
    alias: string | null;
    workspaceId: string;
    workspaceName: string;
  }>;
}

export interface ManageGatewayChannelAccessInput {
  action: GatewayChannelAccessAction;
  gatewayInboundId: string;
  workspace?: string;
  projects?: string[];
  chatName?: string;
}

export type ManageGatewayChannelAccessResult =
  | {
      ok: true;
      deduped: boolean;
      record: GatewayChannelAccessView | null;
      version: number;
      updatedAt: string | null;
    }
  | {
      ok: false;
      needsSelection?: true;
      error: string;
      candidates?: Array<{
        id: string;
        name: string;
        alias?: string | null;
        workspaceId?: string;
        workspaceName?: string;
      }>;
    };

const MAX_CAS_ATTEMPTS = 12;

function emptyConfig(): GatewayChannelAccessConfig {
  return {
    version: GATEWAY_CHANNEL_ACCESS_VERSION,
    revision: 0,
    channels: {},
    mutationReceipts: {},
  };
}

export function normalizeGatewayIdentity(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeGatewayChatId(value: string | null | undefined): string {
  return normalizeGatewayIdentity(value)
    .replace(/^(?:feishu|lark|wechat|weixin):/, "")
    .replace(/^chat:/, "");
}

export function normalizeGatewaySenderId(value: string | null | undefined): string {
  return normalizeGatewayIdentity(value)
    .replace(/^(?:feishu|lark|wechat|weixin):/, "")
    .replace(/^user:/, "");
}

// Collapse same-entity platform aliases so an owner id configured under one
// literal (e.g. "feishu") still matches an inbound labeled with the other
// (e.g. OpenClaw's "lark"). Owner-id VALUES already alias-collapse via the
// prefix strip above; this closes the same gap for the ownerIds map KEY.
export function canonicalGatewayPlatform(value: string | null | undefined): string {
  const platform = normalizeGatewayIdentity(value);
  if (platform === "lark") return "feishu";
  if (platform === "weixin") return "wechat";
  return platform;
}

// Tolerate punctuation variants of the gateway id (e.g. "open-claw" → "openclaw")
// so a cosmetic spelling difference never silently drops the sender to NON_OWNER.
export function canonicalGateway(value: string | null | undefined): string {
  return normalizeGatewayIdentity(value).replace(/[^a-z0-9]/g, "");
}

// Non-reversible-enough fingerprint for diagnostics: keeps the id-type prefix
// and last 4 chars so an operator can eyeball a mismatch without logging the
// full identity. redactSecretValue in the logger is the second safety net.
function ownerIdFingerprint(value: string): string {
  const id = normalizeGatewaySenderId(value);
  if (!id) return "∅";
  return `${id.slice(0, 3)}…${id.length <= 4 ? id : id.slice(-4)}(${id.length})`;
}

export function gatewayChannelAccessKey(input: {
  gateway: string;
  platform: string;
  chatId: string;
}): string {
  return JSON.stringify([
    normalizeGatewayIdentity(input.gateway),
    normalizeGatewayIdentity(input.platform),
    normalizeGatewayChatId(input.chatId),
  ]);
}

function cleanChatName(value: string | null | undefined): string | undefined {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  return name ? name.slice(0, 160) : undefined;
}

function parseScope(value: unknown): GatewayChannelScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.mode === "ALL") return { mode: "ALL" };
  if (raw.mode === "WORKSPACE" && typeof raw.workspaceId === "string" && raw.workspaceId.trim()) {
    return { mode: "WORKSPACE", workspaceId: raw.workspaceId.trim() };
  }
  if (raw.mode === "PROJECTS" && Array.isArray(raw.projectIds)) {
    const projectIds = [...new Set(raw.projectIds
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean))];
    if (projectIds.length > 0) return { mode: "PROJECTS", projectIds };
  }
  return null;
}

function parseRecord(value: unknown): GatewayChannelAccessRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const scope = parseScope(raw.scope);
  const gateway = normalizeGatewayIdentity(typeof raw.gateway === "string" ? raw.gateway : "");
  const platform = normalizeGatewayIdentity(typeof raw.platform === "string" ? raw.platform : "");
  const chatId = normalizeGatewayChatId(typeof raw.chatId === "string" ? raw.chatId : "");
  const authorizedBy = normalizeGatewaySenderId(typeof raw.authorizedBy === "string" ? raw.authorizedBy : "");
  const authorizedAt = typeof raw.authorizedAt === "string" ? raw.authorizedAt : "";
  const updatedBy = normalizeGatewaySenderId(typeof raw.updatedBy === "string" ? raw.updatedBy : authorizedBy);
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : authorizedAt;
  if (!gateway || !platform || !chatId || !scope || !authorizedBy || !authorizedAt || !updatedAt) return null;
  if (raw.status !== "AUTHORIZED" && raw.status !== "REVOKED") return null;
  return {
    gateway,
    platform,
    chatId,
    ...(cleanChatName(typeof raw.chatName === "string" ? raw.chatName : undefined)
      ? { chatName: cleanChatName(String(raw.chatName)) }
      : {}),
    status: raw.status,
    scope,
    authorizedBy,
    authorizedAt,
    updatedBy: updatedBy || authorizedBy,
    updatedAt,
    ...(typeof raw.revokedBy === "string" && raw.revokedBy.trim()
      ? { revokedBy: normalizeGatewaySenderId(raw.revokedBy) }
      : {}),
    ...(typeof raw.revokedAt === "string" && raw.revokedAt ? { revokedAt: raw.revokedAt } : {}),
    revision: Number.isInteger(raw.revision) && Number(raw.revision) > 0 ? Number(raw.revision) : 1,
  };
}

export function parseGatewayChannelAccessConfig(value: unknown): GatewayChannelAccessConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyConfig();
  const raw = value as Record<string, unknown>;
  if (raw.version !== GATEWAY_CHANNEL_ACCESS_VERSION) return emptyConfig();
  const channels: Record<string, GatewayChannelAccessRecord> = {};
  if (raw.channels && typeof raw.channels === "object" && !Array.isArray(raw.channels)) {
    for (const value of Object.values(raw.channels as Record<string, unknown>)) {
      const record = parseRecord(value);
      if (record) channels[gatewayChannelAccessKey(record)] = record;
    }
  }
  const mutationReceipts: Record<string, GatewayChannelMutationReceipt> = {};
  if (raw.mutationReceipts && typeof raw.mutationReceipts === "object" && !Array.isArray(raw.mutationReceipts)) {
    for (const [inboundId, value] of Object.entries(raw.mutationReceipts as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const receipt = value as Record<string, unknown>;
      const record = parseRecord(receipt.record);
      const action = receipt.action;
      if (
        !record
        || !["authorize", "bind_workspace", "bind_projects", "unbind", "revoke"].includes(String(action))
      ) continue;
      mutationReceipts[inboundId] = {
        inboundId,
        action: action as Exclude<GatewayChannelAccessAction, "get">,
        actorId: normalizeGatewaySenderId(String(receipt.actorId ?? "")),
        processedAt: String(receipt.processedAt ?? record.updatedAt),
        channelKey: gatewayChannelAccessKey(record),
        record,
      };
    }
  }
  return {
    version: GATEWAY_CHANNEL_ACCESS_VERSION,
    revision: Number.isInteger(raw.revision) && Number(raw.revision) >= 0 ? Number(raw.revision) : 0,
    channels,
    mutationReceipts,
  };
}

async function readStoredConfig(): Promise<{
  id: string | null;
  serialized: string | null;
  config: GatewayChannelAccessConfig;
}> {
  const row = await db.systemConfig.findUnique({ where: { key: GATEWAY_CHANNEL_ACCESS_CONFIG_KEY } });
  if (!row) return { id: null, serialized: null, config: emptyConfig() };
  try {
    return { id: row.id, serialized: row.value, config: parseGatewayChannelAccessConfig(JSON.parse(row.value)) };
  } catch {
    return { id: row.id, serialized: row.value, config: emptyConfig() };
  }
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

async function updateStoredConfig<T>(
  mutate: (config: GatewayChannelAccessConfig) => Promise<{ config: GatewayChannelAccessConfig; result: T }> | {
    config: GatewayChannelAccessConfig;
    result: T;
  },
): Promise<T> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const current = await readStoredConfig();
    const { config, result } = await mutate(current.config);
    const serialized = JSON.stringify(config);
    if (serialized === current.serialized) return result;
    if (current.id && current.serialized !== null) {
      const updated = await db.systemConfig.updateMany({
        where: { id: current.id, value: current.serialized },
        data: { value: serialized },
      });
      if (updated.count === 1) return result;
      continue;
    }
    try {
      await db.systemConfig.create({
        data: { key: GATEWAY_CHANNEL_ACCESS_CONFIG_KEY, value: serialized },
      });
      return result;
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
    }
  }
  throw new Error("Gateway channel access changed concurrently; retry the command");
}

export async function isConfiguredGatewayOwner(input: {
  gateway: string;
  platform: string;
  senderId?: string | null;
}): Promise<boolean> {
  const gateway = canonicalGateway(input.gateway);
  if (gateway !== "openclaw" && gateway !== "hermes") {
    log.warn("owner check denied", { reason: "gateway_unsupported", gateway });
    return false;
  }
  const senderId = normalizeGatewaySenderId(input.senderId);
  if (!senderId) {
    log.warn("owner check denied", { reason: "sender_missing", gateway });
    return false;
  }
  const runtime = await readHarnessGatewayRuntimeConfig(gateway);
  const platform = canonicalGatewayPlatform(input.platform);
  const ownerIds = runtime.accessPolicy?.ownerIds ?? {};
  // Match the ownerIds map by CANONICAL platform, not literal key, so a
  // whitelist stored under "feishu" still resolves a "lark" inbound and vice versa.
  const whitelist = Object.entries(ownerIds)
    .filter(([key]) => canonicalGatewayPlatform(key) === platform)
    .flatMap(([, ids]) => ids);
  if (whitelist.length === 0) {
    log.warn("owner check denied", {
      reason: "no_owner_ids_for_platform",
      gateway,
      platform,
      configuredPlatforms: Object.keys(ownerIds),
    });
    return false;
  }
  const matched = whitelist.some((ownerId) => normalizeGatewaySenderId(ownerId) === senderId);
  if (!matched) {
    log.warn("owner check denied", {
      reason: "sender_not_in_whitelist",
      gateway,
      platform,
      sender: ownerIdFingerprint(senderId),
      whitelist: whitelist.map(ownerIdFingerprint),
    });
  }
  return matched;
}

async function scopeExists(scope: GatewayChannelScope): Promise<boolean> {
  if (scope.mode === "ALL") return true;
  if (scope.mode === "WORKSPACE") {
    return Boolean(await db.workspace.findUnique({ where: { id: scope.workspaceId }, select: { id: true } }));
  }
  const projectIds = [...new Set(scope.projectIds)];
  const count = await db.project.count({ where: { id: { in: projectIds } } });
  return projectIds.length > 0 && count === projectIds.length;
}

export async function decideGatewayChannelAccess(input: {
  gateway: string;
  platform: string;
  chatId: string;
  senderId?: string | null;
}): Promise<GatewayChannelDecision> {
  if (await isConfiguredGatewayOwner(input)) {
    return { role: "OWNER", allowed: true, scope: { mode: "ALL" } };
  }
  const { config } = await readStoredConfig();
  const record = config.channels[gatewayChannelAccessKey(input)];
  const channel = {
    gateway: canonicalGateway(input.gateway),
    platform: canonicalGatewayPlatform(input.platform),
    chat: normalizeGatewayChatId(input.chatId).slice(0, 8),
  };
  if (!record) {
    log.info("channel access denied", { reason: "CHANNEL_UNAUTHORIZED", ...channel });
    return { role: "NON_OWNER", allowed: false, reason: "CHANNEL_UNAUTHORIZED" };
  }
  if (record.status === "REVOKED") {
    log.info("channel access denied", { reason: "CHANNEL_REVOKED", ...channel });
    return { role: "NON_OWNER", allowed: false, reason: "CHANNEL_REVOKED" };
  }
  if (!(await scopeExists(record.scope))) {
    log.info("channel access denied", { reason: "SCOPE_INVALID", ...channel, scope: record.scope.mode });
    return { role: "NON_OWNER", allowed: false, reason: "SCOPE_INVALID" };
  }
  return { role: "NON_OWNER", allowed: true, scope: record.scope };
}

export function gatewayScopeAllowsProject(
  scope: GatewayChannelScope,
  project: { id: string; workspaceId: string },
): boolean {
  if (scope.mode === "ALL") return true;
  if (scope.mode === "WORKSPACE") return project.workspaceId === scope.workspaceId;
  return scope.projectIds.includes(project.id);
}

async function resolveWorkspace(query: string) {
  const normalized = query.trim().toLowerCase();
  const rows = await db.workspace.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows.filter((row) => row.id === query.trim() || row.name.trim().toLowerCase() === normalized);
}

async function resolveProjects(queries: string[]) {
  const rows = await db.project.findMany({
    select: {
      id: true,
      name: true,
      alias: true,
      workspaceId: true,
      workspace: { select: { name: true } },
    },
    orderBy: [{ name: "asc" }],
  });
  const resolved: typeof rows = [];
  for (const query of queries) {
    const value = query.trim();
    const normalized = value.toLowerCase();
    const matches = rows.filter((row) =>
      row.id === value
      || row.name.trim().toLowerCase() === normalized
      || row.alias?.trim().toLowerCase() === normalized
    );
    if (matches.length !== 1) return { query: value, matches };
    if (!resolved.some((row) => row.id === matches[0].id)) resolved.push(matches[0]);
  }
  return { resolved };
}

async function recordView(record: GatewayChannelAccessRecord | null): Promise<GatewayChannelAccessView | null> {
  if (!record) return null;
  const workspace = record.scope.mode === "WORKSPACE"
    ? await db.workspace.findUnique({
        where: { id: record.scope.workspaceId },
        select: { id: true, name: true },
      })
    : null;
  const projects = record.scope.mode === "PROJECTS"
    ? await db.project.findMany({
        where: { id: { in: record.scope.projectIds } },
        select: {
          id: true,
          name: true,
          alias: true,
          workspaceId: true,
          workspace: { select: { name: true } },
        },
        orderBy: [{ workspace: { name: "asc" } }, { name: "asc" }],
      })
    : [];
  const normalizedProjects = projects.map((project) => ({
    id: project.id,
    name: project.name,
    alias: project.alias,
    workspaceId: project.workspaceId,
    workspaceName: project.workspace.name,
  }));
  return {
    ...record,
    key: gatewayChannelAccessKey(record),
    scopeValid: record.scope.mode === "ALL"
      || (record.scope.mode === "WORKSPACE" ? Boolean(workspace) : normalizedProjects.length === record.scope.projectIds.length),
    workspace,
    projects: normalizedProjects,
  };
}

export async function listGatewayChannelAccess(): Promise<GatewayChannelAccessView[]> {
  const { config } = await readStoredConfig();
  const rows = await Promise.all(Object.values(config.channels).map(recordView));
  return rows.filter((row): row is GatewayChannelAccessView => Boolean(row))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function manageGatewayChannelAccess(
  input: ManageGatewayChannelAccessInput,
): Promise<ManageGatewayChannelAccessResult> {
  const inbound = await db.gatewayInbound.findUnique({
    where: { id: input.gatewayInboundId.trim() },
    select: { id: true, gateway: true, platform: true, chatId: true, senderId: true },
  });
  if (!inbound) return { ok: false, error: "Gateway inbound message not found" };
  if (!(await isConfiguredGatewayOwner(inbound))) {
    return { ok: false, error: "Only the configured platform OWNER may manage channel access" };
  }
  const key = gatewayChannelAccessKey(inbound);
  if (input.action === "get") {
    const { config } = await readStoredConfig();
    const record = await recordView(config.channels[key] ?? null);
    return {
      ok: true,
      deduped: false,
      record,
      version: config.revision,
      updatedAt: record?.updatedAt ?? null,
    };
  }

  let nextScope: GatewayChannelScope | null = null;
  if (input.action === "authorize" || input.action === "unbind") nextScope = { mode: "ALL" };
  if (input.action === "bind_workspace") {
    const query = input.workspace?.trim();
    if (!query) return { ok: false, error: "workspace is required for bind_workspace" };
    const matches = await resolveWorkspace(query);
    if (matches.length !== 1) {
      return {
        ok: false,
        ...(matches.length > 1 ? { needsSelection: true as const } : {}),
        error: matches.length === 0 ? `No workspace matched ${JSON.stringify(query)}` : "Workspace name is ambiguous",
        candidates: matches,
      };
    }
    nextScope = { mode: "WORKSPACE", workspaceId: matches[0].id };
  }
  if (input.action === "bind_projects") {
    const queries = [...new Set((input.projects ?? []).map((item) => item.trim()).filter(Boolean))];
    if (queries.length === 0) return { ok: false, error: "projects is required for bind_projects" };
    const match = await resolveProjects(queries);
    if (!match.resolved) {
      return {
        ok: false,
        ...(match.matches.length > 1 ? { needsSelection: true as const } : {}),
        error: match.matches.length === 0
          ? `No project matched ${JSON.stringify(match.query)}`
          : `Project ${JSON.stringify(match.query)} is ambiguous`,
        candidates: match.matches.map((project) => ({
          id: project.id,
          name: project.name,
          alias: project.alias,
          workspaceId: project.workspaceId,
          workspaceName: project.workspace.name,
        })),
      };
    }
    nextScope = { mode: "PROJECTS", projectIds: match.resolved.map((project) => project.id) };
  }

  const mutation = await updateStoredConfig(async (config) => {
    const priorReceipt = config.mutationReceipts[inbound.id];
    if (priorReceipt) {
      return {
        config,
        result: { record: priorReceipt.record, deduped: true, version: config.revision },
      };
    }
    const current = config.channels[key];
    const now = new Date().toISOString();
    const actorId = normalizeGatewaySenderId(inbound.senderId);
    const chatName = cleanChatName(input.chatName) ?? current?.chatName;
    const record: GatewayChannelAccessRecord = input.action === "revoke"
      ? {
          ...(current ?? {
            gateway: normalizeGatewayIdentity(inbound.gateway),
            platform: normalizeGatewayIdentity(inbound.platform),
            chatId: normalizeGatewayChatId(inbound.chatId),
            status: "REVOKED" as const,
            scope: { mode: "ALL" as const },
            authorizedBy: actorId,
            authorizedAt: now,
            updatedBy: actorId,
            updatedAt: now,
            revision: 0,
          }),
          ...(chatName ? { chatName } : {}),
          status: "REVOKED",
          updatedBy: actorId,
          updatedAt: now,
          revokedBy: actorId,
          revokedAt: now,
          revision: (current?.revision ?? 0) + 1,
        }
      : {
          gateway: normalizeGatewayIdentity(inbound.gateway),
          platform: normalizeGatewayIdentity(inbound.platform),
          chatId: normalizeGatewayChatId(inbound.chatId),
          ...(chatName ? { chatName } : {}),
          status: "AUTHORIZED",
          scope: nextScope!,
          authorizedBy: current?.authorizedBy ?? actorId,
          authorizedAt: current?.authorizedAt ?? now,
          updatedBy: actorId,
          updatedAt: now,
          revision: (current?.revision ?? 0) + 1,
        };
    const nextRevision = config.revision + 1;
    const receipt: GatewayChannelMutationReceipt = {
      inboundId: inbound.id,
      action: input.action,
      actorId,
      processedAt: now,
      channelKey: key,
      record,
    };
    return {
      config: {
        ...config,
        revision: nextRevision,
        channels: { ...config.channels, [key]: record },
        mutationReceipts: { ...config.mutationReceipts, [inbound.id]: receipt },
      },
      result: { record, deduped: false, version: nextRevision },
    };
  });
  const view = await recordView(mutation.record);
  return {
    ok: true,
    deduped: mutation.deduped,
    record: view,
    version: mutation.version,
    updatedAt: view?.updatedAt ?? null,
  };
}
