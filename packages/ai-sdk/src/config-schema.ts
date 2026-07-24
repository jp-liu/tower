export type CliConfigControl =
  | "text"
  | "number"
  | "switch"
  | "select"
  | "multiselect"
  | "path"
  | "string-list"
  | "key-value";

export interface TowerConfigAnnotation {
  control?: CliConfigControl;
  order?: number;
  group?: string;
  advanced?: boolean;
  sensitive?: boolean;
}

export interface CliConfigSchema {
  $schema?: "https://json-schema.org/draft/2020-12/schema" | string;
  $id?: string;
  title?: string;
  description?: string;
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  properties?: Record<string, CliConfigSchema>;
  required?: string[];
  items?: CliConfigSchema;
  enum?: Array<string | number | boolean | null>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean | CliConfigSchema;
  "x-tower"?: TowerConfigAnnotation;
}
