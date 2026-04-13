export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getActiveExecutionsAcrossWorkspaces } from "@/actions/agent-actions";
import { MissionsClient } from "./missions-client";

export default async function MissionsPage() {
  const initialExecutions = await getActiveExecutionsAcrossWorkspaces();
  return <MissionsClient initialExecutions={initialExecutions} />;
}
