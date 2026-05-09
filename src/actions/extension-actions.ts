"use server";

import { getExtension, listExtensions } from "@/lib/extensions/registry";
import type { ExtensionId, ExtensionStatus, ExtensionResult } from "@/lib/extensions/types";

export async function checkExtension(id: ExtensionId): Promise<ExtensionStatus> {
  const ext = getExtension(id);
  if (!ext) return { installed: false, error: `unknown extension: ${id}` };
  return ext.check();
}

export async function installExtension(id: ExtensionId): Promise<ExtensionResult> {
  const ext = getExtension(id);
  if (!ext) return { success: false, error: `unknown extension: ${id}` };
  return ext.install();
}

export async function uninstallExtension(id: ExtensionId): Promise<ExtensionResult> {
  const ext = getExtension(id);
  if (!ext) return { success: false, error: `unknown extension: ${id}` };
  if (!ext.uninstall) return { success: false, error: `extension ${id} does not support uninstall` };
  return ext.uninstall();
}

export async function listAllExtensionStatus(): Promise<Record<ExtensionId, ExtensionStatus>> {
  const exts = listExtensions();
  const entries = await Promise.all(
    exts.map(async (e) => [e.id, await e.check()] as const)
  );
  return Object.fromEntries(entries) as Record<ExtensionId, ExtensionStatus>;
}
