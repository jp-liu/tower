import { claudeLocalAdapter } from "./claude-local";
import type { AdapterModule } from "./types";

const adapters = new Map<string, AdapterModule>([
  [claudeLocalAdapter.type, claudeLocalAdapter],
]);

export function getAdapter(type: string): AdapterModule {
  const adapter = adapters.get(type);
  if (!adapter) throw new Error(`Unknown adapter type: ${type}`);
  return adapter;
}

export function listAdapters(): string[] {
  return Array.from(adapters.keys());
}
