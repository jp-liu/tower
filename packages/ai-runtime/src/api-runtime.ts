import { ApiRuntimeError, normalizeApiError } from "./api-errors.js";
import type {
  ApiAdapter,
  ApiCredential,
  ApiGenerateRequest,
  ApiGenerateResult,
  ApiRuntimeCursor,
  ApiRuntimeExecutionContext,
  ApiStreamEvent,
  ApiStructuredRequest,
} from "./api-types.js";

const ANONYMOUS_CREDENTIAL: ApiCredential = { id: "anonymous", value: "" };

export class ApiConnectionRuntime {
  private readonly candidates: ApiCredential[];

  constructor(
    private readonly adapter: ApiAdapter,
    credentials: ApiCredential[],
    private readonly cursor: ApiRuntimeCursor,
  ) {
    this.candidates = credentials.length > 0 ? [...credentials] : [ANONYMOUS_CREDENTIAL];
  }

  private async orderedCandidates(): Promise<ApiCredential[]> {
    const start = Math.abs(await this.cursor.reserve(this.candidates.length)) % this.candidates.length;
    return this.candidates.map((_, index) => this.candidates[(start + index) % this.candidates.length]!);
  }

  private shouldRotate(error: ApiRuntimeError, activity: boolean, index: number): boolean {
    return !activity && error.retryableWithNextKey && index < this.candidates.length - 1;
  }

  async generate(
    request: ApiGenerateRequest,
    executionContext: ApiRuntimeExecutionContext = {},
  ): Promise<ApiGenerateResult> {
    const candidates = await this.orderedCandidates();
    let lastError: ApiRuntimeError | undefined;
    for (let index = 0; index < candidates.length; index += 1) {
      let activity = false;
      try {
        return await this.adapter.generate(request, {
          credential: candidates[index]!,
          onActivity: (kind) => {
            activity = true;
            executionContext.onActivity?.(kind);
          },
        });
      } catch (error) {
        lastError = normalizeApiError(error);
        if (!this.shouldRotate(lastError, activity, index)) throw lastError;
      }
    }
    throw lastError ?? new ApiRuntimeError({
      code: "unknown",
      message: "The upstream request failed",
      cause: "NoCandidateError",
      retryableWithNextKey: false,
    });
  }

  async generateStructured(
    request: ApiStructuredRequest,
    executionContext: ApiRuntimeExecutionContext = {},
  ): Promise<unknown> {
    const candidates = await this.orderedCandidates();
    let lastError: ApiRuntimeError | undefined;
    for (let index = 0; index < candidates.length; index += 1) {
      let activity = false;
      try {
        return await this.adapter.generateStructured(request, {
          credential: candidates[index]!,
          onActivity: (kind) => {
            activity = true;
            executionContext.onActivity?.(kind);
          },
        });
      } catch (error) {
        lastError = normalizeApiError(error);
        if (!this.shouldRotate(lastError, activity, index)) throw lastError;
      }
    }
    throw lastError!;
  }

  async *stream(
    request: ApiGenerateRequest,
    executionContext: ApiRuntimeExecutionContext = {},
  ): AsyncIterable<ApiStreamEvent> {
    const candidates = await this.orderedCandidates();
    let lastError: ApiRuntimeError | undefined;
    for (let index = 0; index < candidates.length; index += 1) {
      let activity = false;
      try {
        for await (const event of this.adapter.stream(request, {
          credential: candidates[index]!,
          onActivity: (kind) => {
            activity = true;
            executionContext.onActivity?.(kind);
          },
        })) {
          yield event;
        }
        return;
      } catch (error) {
        lastError = normalizeApiError(error);
        if (!this.shouldRotate(lastError, activity, index)) throw lastError;
      }
    }
    throw lastError!;
  }
}

export class MemoryApiRuntimeCursor implements ApiRuntimeCursor {
  private value = 0;

  async reserve(candidateCount: number): Promise<number> {
    const reserved = this.value;
    this.value = (this.value + 1) % Math.max(1, candidateCount);
    return reserved;
  }
}
