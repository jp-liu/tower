import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { continueOrStartTaskExecution } from "@/actions/agent-actions";
import { requireSignedInternalRequest } from "@/lib/internal-api-auth";
import {
  continueGatewayBoundTask,
  resolveGatewayTaskContext,
  type BoundTaskContinuationExecutor,
} from "@/lib/harness/gateway-router";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const contextSchema = z.object({
  gateway: z.enum(["hermes", "openclaw"]),
  platform: z.string().trim().min(1).max(64),
  chatId: z.string().trim().min(1).max(512),
  replyToMessageId: z.string().trim().min(1).max(512).optional(),
  quotedText: z.string().max(16_000).optional(),
  taskId: z.string().trim().min(1).max(128).optional(),
}).strict().refine(
  (value) => value.replyToMessageId || value.quotedText || value.taskId,
  "replyToMessageId, quotedText, or taskId is required",
);

const continuationSchema = contextSchema.safeExtend({
  platformMessageId: z.string().trim().min(1).max(512),
  senderId: z.string().trim().min(1).max(512).optional(),
  content: z.string().trim().min(1).max(10_000),
});

const PORT = process.env.PORT ?? "3000";
const TERMINAL_BRIDGE = `http://localhost:${PORT}/api/internal/terminal`;
const INITIAL_DELAY_MS = 2500;
const RETRY_DELAY_MS = 800;
const MAX_ATTEMPTS = 20;

const executeContinuation: BoundTaskContinuationExecutor = async (taskId, text) => {
  const execution = await continueOrStartTaskExecution(taskId);
  if (execution.mode !== "already_running") {
    await new Promise((resolve) => setTimeout(resolve, INITIAL_DELAY_MS));
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(`${TERMINAL_BRIDGE}/${encodeURIComponent(taskId)}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, submit: true }),
    }).catch(() => null);
    if (response?.ok) {
      return {
        executionId: execution.executionId,
        executionMode: execution.mode,
        injected: true,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  throw new Error("terminal not ready after explicit continuation");
};

function failure(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 400 },
  );
}

export async function POST(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = contextSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid gateway task context request" }, { status: 400 });
  }
  try {
    return NextResponse.json(await resolveGatewayTaskContext(parsed.data));
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
  const blocked = await requireSignedInternalRequest(request);
  if (blocked) return blocked;
  const parsed = continuationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid gateway task continuation request" }, { status: 400 });
  }
  try {
    return NextResponse.json(await continueGatewayBoundTask(parsed.data, executeContinuation));
  } catch (error) {
    return failure(error);
  }
}
