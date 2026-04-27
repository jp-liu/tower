import { redirect } from "next/navigation";
import { getWorkspacesWithProjects } from "@/actions/workspace-actions";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  const workspaces = await getWorkspacesWithProjects();
  if (workspaces.length > 0) {
    redirect(`/workspaces/${workspaces[0].id}`);
  }
  // Fallback — should not happen since last workspace cannot be deleted
  redirect("/onboarding");
}
