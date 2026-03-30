export interface ConfigEntry {
  defaultValue: unknown;
  type: "string" | "number" | "boolean" | "object";
  label: string;
}

export const CONFIG_DEFAULTS: Record<string, ConfigEntry> = {
  "git.pathMappingRules": {
    defaultValue: [],
    type: "object",
    label: "Git Path Mapping Rules",
  },
};
