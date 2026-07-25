export const CLI_SECRET_MASK = "__tower_masked_cli_secret__";

export type CliPluginSecretReference =
  | { kind: "environment"; key: string }
  | { kind: "setting"; key: string };
