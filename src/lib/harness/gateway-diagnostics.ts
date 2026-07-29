import "server-only";

import { db } from "@/lib/db";
import {
  recoverQueuedGatewayWork,
  retryGatewayDeliveries,
} from "./gateway-router";

type DiagnosticStageState = "ok" | "waiting" | "failed" | "manual_review" | "not_applicable";

function stage(
  name: string,
  state: DiagnosticStageState,
  detail: string,
  at?: Date | null,
) {
  return { name, state, detail, at: at?.toISOString() ?? null };
}

function preview(value: string | null | undefined, max = 240): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export async function diagnoseGatewayRequest(reference: {
  inboundId?: string;
  platformMessageId?: string;
}) {
  if (!reference.inboundId && !reference.platformMessageId) {
    throw new Error("inboundId or platformMessageId is required");
  }
  const inbound = await db.gatewayInbound.findFirst({
    where: reference.inboundId
      ? { id: reference.inboundId }
      : { platformMessageId: reference.platformMessageId! },
    include: {
      session: {
        include: {
          project: {
            select: {
              id: true,
              name: true,
              workspace: { select: { id: true, name: true } },
            },
          },
        },
      },
      deliveries: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!inbound) throw new Error("Gateway request not found");

  const [link, event] = await Promise.all([
    db.gatewayTaskLink.findUnique({ where: { inboundId: inbound.id } }),
    db.workbenchEvent.findFirst({
      where: { payload: { contains: inbound.id } },
      orderBy: { createdAt: "desc" },
      include: { batch: true },
    }),
  ]);
  const createdTaskId = link?.taskId ?? inbound.createdTaskId;
  const [createdTask, runtime] = await Promise.all([
    createdTaskId
      ? db.task.findUnique({
          where: { id: createdTaskId },
          select: {
            id: true,
            title: true,
            status: true,
            updatedAt: true,
            executions: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                status: true,
                exitCode: true,
                startedAt: true,
                endedAt: true,
                summary: true,
              },
            },
          },
        })
      : null,
    inbound.session?.workbenchTaskId
      ? db.workbenchRuntime.findUnique({ where: { taskId: inbound.session.workbenchTaskId } })
      : null,
  ]);

  const stages = [
    stage(
      "platform_ingress",
      "ok",
      `${inbound.platform} message persisted once (attempts=${inbound.attempts})`,
      inbound.createdAt,
    ),
    stage(
      "tower_route",
      inbound.state === "FAILED" ? "failed" : inbound.sessionId || ["DIRECT", "TOWER"].includes(inbound.intent) ? "ok" : "waiting",
      inbound.lastError
        ? `Tower route error: ${preview(inbound.lastError)}`
        : `intent=${inbound.intent}, state=${inbound.state}`,
      inbound.updatedAt,
    ),
  ];

  if (inbound.intent === "PROJECT_WORK") {
    stages.push(stage(
      "workbench_inbox",
      event?.state === "CONSUMED"
        ? "ok"
        : event?.state === "PENDING" || event?.state === "PROCESSING"
          ? "waiting"
          : event?.lastError
            ? "failed"
            : "waiting",
      event
        ? `event=${event.state}, batch=${event.batch?.state ?? "not-created"}${event.lastError ? `, error=${preview(event.lastError)}` : ""}`
        : "No durable Workbench event found",
      event?.updatedAt,
    ));
    stages.push(stage(
      "workbench_runtime",
      runtime?.state === "BLOCKED" || runtime?.state === "DEGRADED"
        ? "failed"
        : runtime?.state === "BUSY" || runtime?.state === "STARTING"
          ? "waiting"
          : runtime
            ? "ok"
            : "waiting",
      runtime
        ? `state=${runtime.state}, pending=${runtime.pendingEvents}${runtime.blockedReason ? `, blocked=${preview(runtime.blockedReason)}` : ""}${runtime.lastError ? `, error=${preview(runtime.lastError)}` : ""}`
        : "No Workbench runtime projection found",
      runtime?.updatedAt,
    ));
    stages.push(stage(
      "child_task",
      createdTask
        ? createdTask.status === "CANCELLED" ? "failed" : createdTask.status === "DONE" ? "ok" : "waiting"
        : "waiting",
      createdTask
        ? `task=${createdTask.title}, state=${createdTask.status}, execution=${createdTask.executions[0]?.status ?? "not-started"}`
        : "No durable child task link yet",
      createdTask?.updatedAt,
    ));
  } else {
    stages.push(stage("workbench_inbox", "not_applicable", "This request does not use Workbench"));
    stages.push(stage("workbench_runtime", "not_applicable", "This request does not use Workbench"));
    stages.push(stage("child_task", "not_applicable", "This request does not create a child task"));
  }

  const requiredFinalKinds = inbound.intent === "PROJECT_WORK"
    ? ["QUEUED_ACK", "TASK_CREATED", "FINAL_RESULT"]
    : inbound.intent === "PROJECT_DISCUSSION"
      ? ["DISCUSSION_REPLY"]
      : [];
  const deliveryDetails = inbound.deliveries.map((delivery) => ({
    id: delivery.id,
    kind: delivery.kind,
    state: delivery.state,
    attempts: delivery.attempts,
    platformMessageId: delivery.platformMessageId,
    replyToMessageId: delivery.platformParentId,
    lastError: preview(delivery.lastError),
    nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
    updatedAt: delivery.updatedAt.toISOString(),
  }));
  const deliveryHasManualReview = inbound.deliveries.some((item) => item.state === "SENT_UNVERIFIED");
  const deliveryHasFailure = inbound.deliveries.some((item) => item.state === "FAILED");
  const deliveredKinds = new Set<string>(
    inbound.deliveries.filter((item) => item.state === "DELIVERED").map((item) => item.kind),
  );
  const missingKinds = requiredFinalKinds.filter((kind) => !deliveredKinds.has(kind));
  stages.push(stage(
    "platform_delivery",
    deliveryHasManualReview
      ? "manual_review"
      : deliveryHasFailure
        ? "failed"
        : missingKinds.length === 0
          ? "ok"
          : requiredFinalKinds.length === 0
            ? "not_applicable"
            : "waiting",
    deliveryHasManualReview
      ? "A platform message may already exist, so automatic retry is disabled to prevent duplicates"
      : deliveryHasFailure
        ? `Delivery failed: ${preview(inbound.deliveries.find((item) => item.state === "FAILED")?.lastError)}`
        : missingKinds.length > 0
          ? `Waiting for ${missingKinds.join(", ")}`
          : "All required replies were verified",
    inbound.deliveries.at(-1)?.updatedAt,
  ));

  const firstProblem = stages.find((item) => item.state === "failed" || item.state === "manual_review")
    ?? stages.find((item) => item.state === "waiting");
  const recommendation = firstProblem?.state === "manual_review"
    ? "Check the referenced platform message before any manual resend; Tower intentionally prevents duplicate cards."
    : firstProblem?.name === "platform_delivery"
      ? "Use recover_gateway_request to retry only this request's verified-safe failed deliveries."
      : firstProblem?.name === "workbench_inbox" || firstProblem?.name === "workbench_runtime"
        ? "Use recover_gateway_request to re-open only this request's durable Workbench path."
        : firstProblem
          ? "Inspect the first incomplete stage and its error; recovery will stay scoped to this inbound id."
          : "No incomplete stage detected.";

  return {
    traceId: inbound.id,
    source: {
      gateway: inbound.gateway,
      platform: inbound.platform,
      chatId: inbound.chatId,
      platformMessageId: inbound.platformMessageId,
      senderId: inbound.senderId,
      contentPreview: preview(inbound.content),
    },
    project: inbound.session?.project
      ? {
          projectId: inbound.session.project.id,
          name: inbound.session.project.name,
          workspaceId: inbound.session.project.workspace.id,
          workspaceName: inbound.session.project.workspace.name,
        }
      : null,
    stages,
    deliveries: deliveryDetails,
    event: event
      ? {
          id: event.id,
          state: event.state,
          batchId: event.batchId,
          batchState: event.batch?.state ?? null,
          attempts: event.attempts,
          lastError: preview(event.lastError),
        }
      : null,
    workbench: runtime
      ? {
          taskId: runtime.taskId,
          state: runtime.state,
          activeBatchId: runtime.activeBatchId,
          pendingEvents: runtime.pendingEvents,
          lastHeartbeatAt: runtime.lastHeartbeatAt.toISOString(),
          lastError: preview(runtime.lastError),
        }
      : null,
    childTask: createdTask
      ? {
          id: createdTask.id,
          title: createdTask.title,
          status: createdTask.status,
          execution: createdTask.executions[0] ?? null,
        }
      : null,
    firstIncompleteStage: firstProblem?.name ?? null,
    recommendation,
  };
}

export async function recoverGatewayRequest(inboundId: string) {
  const inbound = await db.gatewayInbound.findUnique({
    where: { id: inboundId },
    select: { id: true, intent: true },
  });
  if (!inbound) throw new Error("Gateway request not found");

  const manualReview = await db.gatewayDelivery.count({
    where: { inboundId, state: "SENT_UNVERIFIED" },
  });
  await db.gatewayDelivery.updateMany({
    where: {
      inboundId,
      state: "FAILED",
      platformMessageId: null,
    },
    data: { nextAttemptAt: new Date() },
  });
  const deliveries = await retryGatewayDeliveries(undefined, new Date(), 20, { inboundId });
  const workbench = inbound.intent === "PROJECT_WORK"
    ? await recoverQueuedGatewayWork(undefined, 1, undefined, undefined, { inboundId })
    : { scanned: 0, started: 0, failed: 0 };
  return {
    inboundId,
    deliveries,
    workbench,
    manualReviewRequired: manualReview > 0,
    message: manualReview > 0
      ? "Safe recovery ran, but at least one sent-unverified delivery still requires platform review."
      : "Safe recovery ran only for this gateway request.",
  };
}
