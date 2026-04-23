import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import type { TaskCompletionPayload } from "@/actions/onboarding-actions";
import type { StopEvent } from "@/app/api/internal/hooks/stop/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// D-04: globalThis singleton — survives HMR/module re-evaluation in Next.js dev mode.
const g = globalThis as typeof globalThis & {
  __taskCompletionQueue?: TaskCompletionPayload[];
  __stopEventQueue?: StopEvent[];
};

export async function GET(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const completionEvents = g.__taskCompletionQueue ?? [];
  g.__taskCompletionQueue = [];

  const stopEvents = g.__stopEventQueue ?? [];
  g.__stopEventQueue = [];

  return NextResponse.json({ events: completionEvents, stopEvents });
}
