import "server-only";

import { listExtensionMetadata } from "./metadata";
import { getExtension } from "./registry";
import { mergeLegacyInventory, projectLegacyExtension } from "./legacy-inventory";
import type { ExtensionMetadata, ExtensionStatus } from "./types";
import type { ExtensionInventoryItem } from "./inventory-types";

export type ExtensionStatusReader = (
  id: ExtensionMetadata["id"],
) => Promise<ExtensionStatus>;

async function readLegacyStatus(
  id: ExtensionMetadata["id"],
): Promise<ExtensionStatus> {
  const extension = getExtension(id);
  if (!extension) {
    return { installed: false, error: `unknown extension: ${id}` };
  }

  try {
    return await extension.check();
  } catch (error) {
    return {
      installed: false,
      error: error instanceof Error ? error.message : "extension check failed",
    };
  }
}

export async function buildLegacyExtensionInventory(
  metadata: ReadonlyArray<ExtensionMetadata>,
  readStatus: ExtensionStatusReader,
): Promise<ExtensionInventoryItem[]> {
  const projected = await Promise.all(metadata.map(async (entry) => {
    let status: ExtensionStatus;
    try {
      status = await readStatus(entry.id);
    } catch (error) {
      status = {
        installed: false,
        error: error instanceof Error ? error.message : "extension check failed",
      };
    }
    return projectLegacyExtension(entry, status);
  }));

  return mergeLegacyInventory(projected);
}

export async function listExtensionInventory(): Promise<ExtensionInventoryItem[]> {
  return buildLegacyExtensionInventory(listExtensionMetadata(), readLegacyStatus);
}

