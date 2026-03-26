export interface ExecutionContext {
  runId: string;
  prompt: string;
  cwd: string;
  model?: string;
  sessionId?: string;
  instructionsFile?: string;
  env?: Record<string, string>;
  timeoutSec?: number;
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}

export interface ExecutionResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  summary: string;
  sessionId?: string;
  usage?: UsageSummary;
  model?: string;
  costUsd?: number;
  errorMessage?: string;
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface TestResult {
  ok: boolean;
  checks: TestCheck[];
}

export interface TestCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface AdapterModule {
  type: string;
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
  testEnvironment(cwd: string): Promise<TestResult>;
}
