import { NextResponse } from "next/server";
import type { TaskCompletionPayload } from "@/actions/onboarding-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// D-04: globalThis singleton — survives HMR/module re-evaluation in Next.js dev mode.
const g = globalThis as typeof globalThis & {
  __taskCompletionQueue?: TaskCompletionPayload[];
};

export async function GET() {
  const events = g.__taskCompletionQueue ?? [];
  g.__taskCompletionQueue = [];
  return NextResponse.json({ events });
}
