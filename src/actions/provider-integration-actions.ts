"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  inspectProviderIntegrations,
  reconcileProviderIntegrations,
} from "@/lib/ai/provider-reconciliation";

const inputSchema = z.object({
  provider: z.string().trim().min(1).max(214).optional(),
  connectionId: z.string().trim().min(1).max(200).optional(),
}).refine((input) => input.provider || input.connectionId, {
  message: "provider or connectionId is required",
});

export async function inspectCliProviderIntegrations(input: {
  provider?: string;
  connectionId?: string;
}) {
  return inspectProviderIntegrations(inputSchema.parse(input));
}

export async function reconcileCliProviderIntegrations(input: {
  provider?: string;
  connectionId?: string;
}) {
  const parsed = inputSchema.parse(input);
  const result = await reconcileProviderIntegrations({
    ...parsed,
    trigger: "dependency-changed",
  });
  revalidatePath("/settings");
  return result;
}

export async function repairCliProviderIntegrations(input: {
  provider?: string;
  connectionId?: string;
}) {
  const parsed = inputSchema.parse(input);
  const result = await reconcileProviderIntegrations({
    ...parsed,
    trigger: "manual-repair",
  });
  revalidatePath("/settings");
  return result;
}
