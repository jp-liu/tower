export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getHarnessMessages } from "@/actions/harness-actions";
import { HarnessClient } from "./harness-client";

export default async function HarnessPage() {
  const initial = await getHarnessMessages("pending").catch(() => []);
  return <HarnessClient initial={initial} />;
}
