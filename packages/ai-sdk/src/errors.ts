export type CliPluginErrorCode =
  | "INVALID_MANIFEST"
  | "INCOMPATIBLE_API_VERSION"
  | "CLI_NOT_FOUND"
  | "COMMAND_NOT_EXECUTABLE"
  | "SPAWN_FAILED"
  | "PROCESS_TIMEOUT"
  | "PROCESS_CANCELLED"
  | "QUERY_FAILED"
  | "MODEL_NOT_AVAILABLE"
  | "UNSUPPORTED_CAPABILITY"
  | "INTEGRATION_FAILED";

export class CliPluginError extends Error {
  readonly code: CliPluginErrorCode;
  readonly provider?: string;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(
    code: CliPluginErrorCode,
    message: string,
    options: { provider?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "CliPluginError";
    this.code = code;
    this.provider = options.provider;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
  }
}
