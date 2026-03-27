import type { ExecutionContext, ExecutionResult } from "../types";
import { runChildProcess } from "../process-utils";
import {
  parseClaudeStreamJson,
  isClaudeUnknownSessionError,
  describeClaudeFailure,
  detectClaudeLoginRequired,
} from "./parse";

export async function execute(ctx: ExecutionContext): Promise<ExecutionResult> {
  const {
    runId,
    prompt,
    cwd,
    model,
    sessionId,
    instructionsFile,
    env = {},
    timeoutSec = 0,
    onLog,
  } = ctx;

  const buildArgs = (resumeSessionId: string | null): string[] => {
    const args = ["--print", "-", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
    if (resumeSessionId) args.push("--resume", resumeSessionId);
    if (model) args.push("--model", model);
    if (instructionsFile) args.push("--append-system-prompt-file", instructionsFile);
    return args;
  };

  const runAttempt = async (resumeSessionId: string | null) => {
    const args = buildArgs(resumeSessionId);
    const proc = await runChildProcess(runId, "claude", args, {
      cwd,
      env,
      stdin: prompt,
      timeoutSec,
      graceSec: 20,
      onLog,
    });
    const parsedStream = parseClaudeStreamJson(proc.stdout);
    const parsed = parsedStream.resultJson;
    return { proc, parsedStream, parsed };
  };

  const toResult = (attempt: Awaited<ReturnType<typeof runAttempt>>): ExecutionResult => {
    const { proc, parsedStream, parsed } = attempt;

    if (proc.timedOut) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: true,
        summary: "",
        errorMessage: `Timed out after ${timeoutSec}s`,
      };
    }

    if (!parsed) {
      const loginMeta = detectClaudeLoginRequired({
        parsed: null,
        stdout: proc.stdout,
        stderr: proc.stderr,
      });
      const stderrLine =
        proc.stderr
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find(Boolean) ?? "";
      const errorMessage = loginMeta.requiresLogin
        ? "Claude login required"
        : stderrLine
          ? `Claude exited with code ${proc.exitCode ?? -1}: ${stderrLine}`
          : `Claude exited with code ${proc.exitCode ?? -1}`;
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: false,
        summary: "",
        errorMessage,
      };
    }

    const exitCode = proc.exitCode ?? 0;
    const errorMessage =
      exitCode !== 0
        ? (describeClaudeFailure(parsed) ?? `Claude exited with code ${exitCode}`)
        : undefined;

    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      summary: parsedStream.summary,
      sessionId: parsedStream.sessionId ?? undefined,
      usage: parsedStream.usage ?? undefined,
      model: parsedStream.model || undefined,
      costUsd: parsedStream.costUsd ?? undefined,
      errorMessage,
    };
  };

  const initial = await runAttempt(sessionId ?? null);

  if (
    sessionId &&
    !initial.proc.timedOut &&
    (initial.proc.exitCode ?? 0) !== 0 &&
    initial.parsed &&
    isClaudeUnknownSessionError(initial.parsed)
  ) {
    await onLog(
      "stderr",
      `[claude-local] Session "${sessionId}" unavailable; retrying with fresh session.\n`,
    );
    const retry = await runAttempt(null);
    return toResult(retry);
  }

  return toResult(initial);
}
