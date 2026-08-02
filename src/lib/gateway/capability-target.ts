import "server-only";

import { createHash } from "node:crypto";
import { readConfigValue } from "@/lib/config-reader";

type ConfiguredTarget = {
  id?: string;
  gateway?: string;
  downstream?: string;
  dest?: string;
  active?: boolean;
  scope?: string;
};

export interface OwnerHomeTarget {
  id: string;
  gateway: "hermes" | "openclaw";
  downstream: string;
  dest: string | null;
  fingerprint: string;
}

function targetFingerprint(target: Omit<OwnerHomeTarget, "fingerprint">): string {
  return createHash("sha256")
    .update(JSON.stringify({
      id: target.id,
      gateway: target.gateway,
      downstream: target.downstream,
      dest: target.dest,
    }))
    .digest("hex");
}

export async function readOwnerHomeTarget(): Promise<OwnerHomeTarget | null> {
  const configured = await readConfigValue<ConfiguredTarget[]>("harness.targets", []);
  const selected = (Array.isArray(configured) ? configured : []).find((target) =>
    target?.active && (target.scope ?? "unattended") === "unattended",
  );
  const gateway = selected?.gateway?.trim().toLowerCase();
  const downstream = selected?.downstream?.trim().toLowerCase() || "";
  const dest = selected?.dest?.trim() || null;
  if (!selected || (gateway !== "openclaw" && gateway !== "hermes") || !downstream) return null;
  // OpenClaw has no implicit OWNER route. Hermes may own a provider-specific
  // home route, which is intentionally represented without exposing an id.
  if (gateway === "openclaw" && !dest) return null;
  const normalized = {
    id: selected.id?.trim() || `${gateway}:${downstream}:unattended`,
    gateway,
    downstream,
    dest,
  } satisfies Omit<OwnerHomeTarget, "fingerprint">;
  return { ...normalized, fingerprint: targetFingerprint(normalized) };
}
