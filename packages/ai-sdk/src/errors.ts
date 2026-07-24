export type CliPluginErrorCode =
  | "INVALID_MANIFEST"
  | "INCOMPATIBLE_API_VERSION"
  | "CLI_NOT_FOUND"
  | "COMMAND_NOT_EXECUTABLE"
  | "SPAWN_FAILED"
  | "PROCESS_TIMEOUT"
  | "PROCESS_CANCELLED"
  | "QUERY_FAILED"
  | "AUTHENTICATION_FAILED"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "CONTENT_SAFETY"
  | "INVALID_REQUEST"
  | "TOOL_ERROR"
  | "NO_OUTPUT"
  | "PROVIDER_FAILURE"
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

/** Provider-neutral floor for classifying completed one-shot query failures. */
export function classifyCliQueryFailure(output: string): CliPluginErrorCode {
  const text = output.toLowerCase();
  if (/\b(?:401|unauthorized|authentication failed|not authenticated|login required|api key required)\b/.test(text)) {
    return "AUTHENTICATION_FAILED";
  }
  if (/\b(?:403|forbidden|permission denied|access denied)\b/.test(text)) return "PERMISSION_DENIED";
  if (/\b(?:429|rate limit|too many requests|quota exceeded)\b/.test(text)) return "RATE_LIMITED";
  if (/\b(?:timed? out|timeout)\b/.test(text)) return "PROCESS_TIMEOUT";
  if (/\bmodel.*(?:not found|unavailable|not available|unsupported)\b/.test(text)) {
    return "MODEL_NOT_AVAILABLE";
  }
  if (/\b(?:content safety|safety policy|policy violation|blocked content)\b/.test(text)) {
    return "CONTENT_SAFETY";
  }
  if (/\b(?:econn\w*|network error|fetch failed|dns|socket|unreachable)\b/.test(text)) return "NETWORK_ERROR";
  if (/\b(?:invalid request|invalid argument|bad request)\b/.test(text)) return "INVALID_REQUEST";
  return "PROVIDER_FAILURE";
}
