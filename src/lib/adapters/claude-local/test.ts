import type { TestResult, TestCheck } from "../types";
import { ensureCommandResolvable, runChildProcess } from "../process-utils";
import { parseClaudeStreamJson, detectClaudeLoginRequired } from "./parse";

export async function testEnvironment(cwd: string): Promise<TestResult> {
  const checks: TestCheck[] = [];

  // Check 1: verify `claude` command exists
  try {
    await ensureCommandResolvable("claude", cwd, { ...process.env });
    checks.push({
      name: "claude_command_resolvable",
      passed: true,
      message: "claude command found in PATH",
    });
  } catch (err) {
    checks.push({
      name: "claude_command_resolvable",
      passed: false,
      message: err instanceof Error ? err.message : "claude command not found in PATH",
    });
    return { ok: false, checks };
  }

  // Check 2: verify ANTHROPIC_API_KEY (optional — claude may use browser auth)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasApiKey = typeof apiKey === "string" && apiKey.trim().length > 0;
  checks.push({
    name: "anthropic_api_key",
    passed: hasApiKey,
    message: hasApiKey
      ? "ANTHROPIC_API_KEY is set"
      : "ANTHROPIC_API_KEY is not set (claude may use browser/subscription auth)",
  });

  // Check 3: run hello probe
  const probeId = `claude-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    const probe = await runChildProcess(
      probeId,
      "claude",
      ["--print", "-", "--output-format", "stream-json", "--verbose"],
      {
        cwd,
        env: {},
        stdin: "Respond with just the word hello",
        timeoutSec: 45,
        graceSec: 5,
        onLog: async () => {},
      },
    );

    const parsedStream = parseClaudeStreamJson(probe.stdout);
    const parsed = parsedStream.resultJson;
    const loginMeta = detectClaudeLoginRequired({
      parsed,
      stdout: probe.stdout,
      stderr: probe.stderr,
    });

    if (loginMeta.requiresLogin) {
      const hint = loginMeta.loginUrl
        ? `Run \`claude login\` and complete sign-in at ${loginMeta.loginUrl}`
        : "Run `claude login` to authenticate";
      checks.push({
        name: "claude_hello_probe",
        passed: false,
        message: `Claude login required. ${hint}`,
      });
    } else if (probe.timedOut) {
      checks.push({
        name: "claude_hello_probe",
        passed: false,
        message: "Claude hello probe timed out",
      });
    } else if ((probe.exitCode ?? 1) === 0) {
      const summary = parsedStream.summary.trim();
      const hasHello = /\bhello\b/i.test(summary);
      checks.push({
        name: "claude_hello_probe",
        passed: hasHello,
        message: hasHello
          ? "Claude hello probe succeeded"
          : `Claude probe ran but returned unexpected output: ${summary.slice(0, 120)}`,
      });
    } else {
      const stderrLine =
        probe.stderr
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find(Boolean) ?? "";
      checks.push({
        name: "claude_hello_probe",
        passed: false,
        message: stderrLine
          ? `Claude hello probe failed: ${stderrLine}`
          : `Claude hello probe failed with exit code ${probe.exitCode ?? -1}`,
      });
    }
  } catch (err) {
    checks.push({
      name: "claude_hello_probe",
      passed: false,
      message: err instanceof Error ? err.message : "Claude hello probe threw an error",
    });
  }

  const ok = checks.every((c) => c.passed || c.name === "anthropic_api_key");
  return { ok, checks };
}
