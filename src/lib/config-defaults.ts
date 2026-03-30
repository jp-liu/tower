export interface ConfigEntry {
  defaultValue: unknown;
  type: "string" | "number" | "boolean" | "object";
  label: string;
}

export const CONFIG_DEFAULTS: Record<string, ConfigEntry> = {
  // Phase 11: empty registry — entries added in Phase 12-13
};
