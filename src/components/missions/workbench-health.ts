import type { ActiveExecutionInfo } from "@/actions/agent-actions";
import type { TranslationKey } from "@/lib/i18n";

export const WORKBENCH_HEARTBEAT_STALE_MS = 12_000;

type WorkbenchRuntime = ActiveExecutionInfo["workbenchRuntime"];
type WorkbenchLocale = "zh" | "en";
type Translate = (key: TranslationKey, vars?: Record<string, string>) => string;

export interface WorkbenchHealthRow {
  label: string;
  value: string;
}

export interface WorkbenchHealthPresentation {
  badgeLabel: string;
  detailRows: WorkbenchHealthRow[];
  unhealthy: boolean;
}

const STATUS_KEYS = {
  STARTING: "missions.workbench.status.starting",
  IDLE: "missions.workbench.status.idle",
  BUSY: "missions.workbench.status.busy",
  BLOCKED: "missions.workbench.status.blocked",
  DEGRADED: "missions.workbench.status.degraded",
  STOPPED: "missions.workbench.status.unavailable",
} as const satisfies Record<NonNullable<WorkbenchRuntime>["state"], TranslationKey>;

const BLOCKED_REASON_KEYS: Record<string, TranslationKey> = {
  "Database execution is RUNNING but no live terminal session exists": "missions.workbench.reason.noLiveTerminal",
  "Workbench is processing a durable batch": "missions.workbench.reason.processingBatch",
  "Provider turn in progress": "missions.workbench.reason.providerTurn",
  "Durable work is awaiting dispatch": "missions.workbench.reason.awaitingDispatch",
  "Server restarted and the previous terminal session was not recoverable": "missions.workbench.reason.serverRestarted",
  "Workbench terminal was stopped": "missions.workbench.reason.terminalStopped",
  "Claiming durable Workbench batch": "missions.workbench.reason.claimingBatch",
  "Waiting for Workbench batch acknowledgement": "missions.workbench.reason.awaitingAcknowledgement",
  "Workbench batch delivery failed": "missions.workbench.reason.deliveryFailed",
  "Workbench acknowledged the batch and is processing it": "missions.workbench.reason.batchAcknowledged",
  "Batch resolved; provider turn is still in progress": "missions.workbench.reason.batchResolvedProviderBusy",
  "Provider turn completed with an active Workbench batch": "missions.workbench.reason.providerCompletedWithBatch",
  "Waiting for the current execution's provider-confirmed turn boundary": "missions.workbench.reason.awaitingTurnBoundary",
  "Workbench reconciliation failed": "missions.workbench.reason.reconciliationFailed",
  "Batch responsibility lease expired; work returned to pending": "missions.workbench.reason.leaseExpired",
};

export function inspectWorkbenchHealth(
  runtime: WorkbenchRuntime,
  now = Date.now(),
): {
  unhealthy: boolean;
  heartbeatStale: boolean;
  synchronizationStale: boolean;
  providerTurnInProgress: boolean;
} {
  if (!runtime) {
    return {
      unhealthy: true,
      heartbeatStale: false,
      synchronizationStale: true,
      providerTurnInProgress: false,
    };
  }
  const heartbeatAt = runtime.lastHeartbeatAt
    ? new Date(runtime.lastHeartbeatAt).getTime()
    : null;
  const heartbeatStale = heartbeatAt !== null
    && (!Number.isFinite(heartbeatAt) || now - heartbeatAt > WORKBENCH_HEARTBEAT_STALE_MS);
  const synchronizationStale = runtime.syncState !== "CURRENT";
  const providerTurnInProgress = runtime.state === "BUSY"
    && runtime.activeBatchId === null
    && runtime.pendingEvents === 0;
  return {
    unhealthy: synchronizationStale
      || heartbeatStale
      || runtime.state === "STARTING"
      || runtime.state === "BLOCKED"
      || runtime.state === "DEGRADED"
      || runtime.state === "STOPPED",
    heartbeatStale,
    synchronizationStale,
    providerTurnInProgress,
  };
}

export function localizeWorkbenchReason(reason: string, t: Translate): string {
  const key = BLOCKED_REASON_KEYS[reason];
  return key ? t(key) : reason;
}

export function formatWorkbenchHeartbeat(
  heartbeatAt: string | null,
  locale: WorkbenchLocale,
  t: Translate,
  now = Date.now(),
): string {
  if (!heartbeatAt) return t("missions.workbench.notReported");
  const timestamp = new Date(heartbeatAt).getTime();
  if (!Number.isFinite(timestamp)) return t("missions.workbench.notReported");

  const intlLocale = locale === "zh" ? "zh-CN" : "en-US";
  const difference = timestamp - now;
  const absoluteDifference = Math.abs(difference);
  const [divisor, unit] = absoluteDifference < 60_000
    ? [1_000, "second" as const]
    : absoluteDifference < 3_600_000
      ? [60_000, "minute" as const]
      : absoluteDifference < 86_400_000
        ? [3_600_000, "hour" as const]
        : [86_400_000, "day" as const];
  const relative = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" })
    .format(Math.round(difference / divisor), unit);
  const exact = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(timestamp);
  return `${relative} (${exact})`;
}

export function projectWorkbenchHealth(
  runtime: WorkbenchRuntime,
  locale: WorkbenchLocale,
  t: Translate,
  now = Date.now(),
): WorkbenchHealthPresentation {
  const health = inspectWorkbenchHealth(runtime, now);
  const statusKey = !runtime
    ? "missions.workbench.status.unavailable"
    : runtime.state === "BLOCKED" || runtime.state === "STARTING"
      ? STATUS_KEYS[runtime.state]
      : health.heartbeatStale || health.synchronizationStale
        ? "missions.workbench.status.degraded"
        : STATUS_KEYS[runtime.state];
  const status = t(statusKey);
  const pendingEvents = runtime?.pendingEvents ?? null;
  const badgeLabel = [
    t("missions.workbench.title"),
    status,
    pendingEvents !== null && pendingEvents > 0 ? String(pendingEvents) : null,
  ].filter(Boolean).join(" · ");
  const detailRows: WorkbenchHealthRow[] = [
    { label: t("missions.workbench.detail.status"), value: status },
    {
      label: t("missions.workbench.detail.pending"),
      value: pendingEvents === null ? t("missions.workbench.unknown") : String(pendingEvents),
    },
    {
      label: t("missions.workbench.detail.heartbeat"),
      value: formatWorkbenchHeartbeat(runtime?.lastHeartbeatAt ?? null, locale, t, now),
    },
  ];

  if (runtime?.activeBatchId) {
    detailRows.push({
      label: t("missions.workbench.detail.batch"),
      value: runtime.activeBatchId,
    });
  }
  const blockedReason = runtime?.blockedReason
    ?? (health.providerTurnInProgress ? "Provider turn in progress" : null);
  if (blockedReason) {
    detailRows.push({
      label: t("missions.workbench.detail.reason"),
      value: localizeWorkbenchReason(blockedReason, t),
    });
  }
  if (runtime?.lastError) {
    detailRows.push({
      label: t("missions.workbench.detail.error"),
      value: runtime.lastError,
    });
  }
  if (health.synchronizationStale) {
    detailRows.push({
      label: t("missions.workbench.detail.notice"),
      value: t("missions.workbench.executionStale"),
    });
  }
  if (health.heartbeatStale) {
    detailRows.push({
      label: t("missions.workbench.detail.notice"),
      value: t("missions.workbench.heartbeatStale"),
    });
  }

  return { badgeLabel, detailRows, unhealthy: health.unhealthy };
}
