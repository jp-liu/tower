import type { CliAdapter } from "@tower/ai-sdk";

/** Repair persisted hook paths before command discovery, even when the CLI is absent. */
export async function repairHooksBeforeResolve<T>(
  builtInAdapter: CliAdapter,
  resolve: () => Promise<T>,
): Promise<T> {
  await builtInAdapter.hooks?.install({ repairOnly: true }).catch(() => {});
  return resolve();
}

/** A refresh without version output must not erase a version recorded by a successful probe. */
export function providerRefreshVersion(
  resolvedVersion: string | null | undefined,
  recordedVersion: string | null | undefined,
): string | null {
  return resolvedVersion ?? recordedVersion ?? null;
}
