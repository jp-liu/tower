import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";

function isAbsoluteUri(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function assertCatalogJsonSchema(
  value: unknown,
  schema: unknown,
  label = "Extension catalog",
): void {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat("uri", { type: "string", validate: isAbsoluteUri });
  const validate = ajv.compile(schema as AnySchema);
  if (!validate(value)) {
    const detail = ajv.errorsText(validate.errors, { separator: "; " });
    throw new Error(`${label} does not match its JSON Schema: ${detail}`);
  }
}
