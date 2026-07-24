import {
  APICallError,
  InvalidArgumentError,
  InvalidPromptError,
  NoContentGeneratedError,
  NoSuchModelError,
} from "@ai-sdk/provider";
import { NoObjectGeneratedError, NoOutputGeneratedError } from "ai";
import type { ApiErrorCode, ApiRuntimeErrorShape } from "./api-types.js";

const SAFE_MESSAGES: Record<ApiErrorCode, string> = {
  connection_unavailable: "The API connection is unavailable",
  authentication: "Authentication failed",
  permission: "The credential does not have permission for this request",
  rate_limit: "The upstream service rate limit was reached",
  network: "The upstream service could not be reached",
  timeout: "The upstream request timed out",
  invalid_request: "The upstream request configuration is invalid",
  model_unavailable: "The selected model is unavailable",
  content_safety: "The upstream service rejected the request for content safety",
  cancelled: "The request was cancelled",
  tool_error: "A tool execution failed",
  no_output: "The upstream service returned no usable output",
  provider_failure: "The upstream service could not complete the request",
  structured_output_invalid: "The structured response could not be parsed",
  unknown: "The upstream request failed",
};

export class ApiRuntimeError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  readonly causeSummary?: string;
  readonly retryableWithNextKey: boolean;

  constructor(shape: ApiRuntimeErrorShape) {
    super(shape.message);
    this.name = "ApiRuntimeError";
    this.code = shape.code;
    this.status = shape.status;
    this.causeSummary = shape.cause;
    this.retryableWithNextKey = shape.retryableWithNextKey;
  }

  toJSON(): ApiRuntimeErrorShape {
    return {
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.causeSummary === undefined ? {} : { cause: this.causeSummary }),
      retryableWithNextKey: this.retryableWithNextKey,
    };
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`.toLowerCase();
  return String(error).toLowerCase();
}

function classify(error: unknown, status?: number): ApiErrorCode {
  const text = errorText(error);
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  if (text.includes("abort") || text.includes("cancelled") || text.includes("canceled")) return "cancelled";
  if (text.includes("timeout") || text.includes("timed out")) return "timeout";
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 429) return "rate_limit";
  if (NoObjectGeneratedError.isInstance(error)) return "structured_output_invalid";
  if (NoOutputGeneratedError.isInstance(error) || NoContentGeneratedError.isInstance(error)) return "no_output";
  if (status === 404 && text.includes("model")) return "model_unavailable";
  if (text.includes("content safety") || text.includes("safety policy") || text.includes("blocked_reason")) {
    return "content_safety";
  }
  if (NoSuchModelError.isInstance(error)) return "model_unavailable";
  if (InvalidArgumentError.isInstance(error) || InvalidPromptError.isInstance(error)) return "invalid_request";
  if (status !== undefined && status >= 400 && status < 500) return "invalid_request";
  if (status !== undefined && status >= 500) return "provider_failure";
  if (error instanceof TypeError || text.includes("fetch failed") || text.includes("econn")) return "network";
  return "unknown";
}

export function normalizeApiError(error: unknown): ApiRuntimeError {
  if (error instanceof ApiRuntimeError) return error;
  const status = APICallError.isInstance(error) ? error.statusCode : undefined;
  const code = classify(error, status);
  const cause = error instanceof Error ? error.name : typeof error;
  return new ApiRuntimeError({
    code,
    message: SAFE_MESSAGES[code],
    ...(status === undefined ? {} : { status }),
    cause,
    retryableWithNextKey: code === "authentication" || code === "permission" || code === "rate_limit",
  });
}

export function apiErrorFromStatus(status: number): ApiRuntimeError {
  const code: ApiErrorCode = status === 401
    ? "authentication"
    : status === 403
      ? "permission"
      : status === 429
        ? "rate_limit"
        : status === 404
          ? "model_unavailable"
          : status >= 500
            ? "provider_failure"
          : status >= 400 && status < 500
            ? "invalid_request"
            : "unknown";
  return new ApiRuntimeError({
    code,
    message: SAFE_MESSAGES[code],
    status,
    cause: "HTTPError",
    retryableWithNextKey: code === "authentication" || code === "permission" || code === "rate_limit",
  });
}

export function safeErrorShape(error: unknown): ApiRuntimeErrorShape {
  return normalizeApiError(error).toJSON();
}
