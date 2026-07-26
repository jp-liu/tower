import { homedir } from "node:os";
import { providerRegistry } from "./ai/providers";
import { ControlledProcessExecutor, evaluateCliDependency } from "@tower/ai-runtime";
import {
  createBuiltInAdapter,
  providerBaseEnvironment,
  resolveBuiltInCommandResolution,
} from "./ai/provider-host";

// ---------------------------------------------------------------------------
// Types (from adapters/types.ts)
// ---------------------------------------------------------------------------

export interface TestResult {
  ok: boolean;
  checks: TestCheck[];
}

export interface TestCheck {
  name: string;
  passed: boolean;
  message: string;
}

const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

function sanitizeDiagnostic(value: string): string {
  let sanitized = value;
  const homePaths = [homedir(), process.env.USERPROFILE].filter(
    (item): item is string => typeof item === "string" && item.length > 1,
  );
  for (const homePath of homePaths) sanitized = sanitized.split(homePath).join("~");
  for (const [key, secret] of Object.entries(process.env)) {
    if (!/(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) continue;
    if (secret && secret.length >= 4) sanitized = sanitized.split(secret).join("[redacted]");
  }
  return sanitized;
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extract a useful summary from probe stdout when a zero-exit probe did not
 * produce usable response text. Tries stream-json parsing first (every line is a JSON event:
 * `assistant`, `result`, `hook_started/completed/failed`, ...). Without this,
 * users see only the first 120 bytes — typically just
 * `{"type":"system","subtype":"hook_started"...`, which hides whatever actually
 * went wrong.
 */
function buildProbeMismatchMessage(command: string, output: string): string {
  const events: Record<string, unknown>[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const json = parseJson(trimmed);
    if (json) events.push(json);
  }

  if (events.length > 0) {
    const hookFailures = events
      .filter((e) => e.subtype === "hook_failed" || e.subtype === "hook_error")
      .map((e) => `${e.hook_name ?? "hook"}: ${e.error ?? e.message ?? "failed"}`);

    const assistantText = events
      .filter((e) => e.type === "assistant" || e.type === "result")
      .map((e) => extractText(e))
      .filter(Boolean)
      .join(" ")
      .trim();

    const parts: string[] = [];
    if (hookFailures.length) parts.push(`hook errors: ${hookFailures.join("; ")}`);
    if (assistantText) parts.push(`assistant said: ${assistantText.slice(0, 400)}`);
    if (parts.length === 0) {
      // Stream-json parsed but no assistant message — claude likely cut off
      // before responding. Surface the last event so we can diagnose.
      const last = events[events.length - 1];
      parts.push(`last event: ${JSON.stringify(last).slice(0, 400)}`);
    }
    return `${command} probe ran but produced no usable response text — ${parts.join("; ")}`;
  }

  return `${command} probe ran but produced no usable response text`;
}

/** Walk stream-json events and return the concatenated assistant/result text. */
function extractAssistantText(output: string): string {
  const parts: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const json = parseJson(trimmed);
    if (!json) continue;
    if (json.type === "assistant" || json.type === "result") {
      const text = extractText(json);
      if (text) parts.push(text);
    }
  }
  return parts.join(" ").trim();
}

function extractText(event: Record<string, unknown>): string {
  // Claude stream-json: { type: "assistant", message: { content: [{ type: "text", text: "…" }, …] } }
  const msg = event.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => (c as Record<string, unknown>).type === "text")
      .map((c) => String((c as Record<string, unknown>).text ?? ""))
      .join(" ");
  }
  // Codex / fallback shapes
  if (typeof event.result === "string") return event.result;
  if (typeof event.text === "string") return event.text;
  return "";
}

// ---------------------------------------------------------------------------
// testEnvironment (from adapters/claude-local/test.ts)
// ---------------------------------------------------------------------------

export async function testEnvironment(cwd: string, providerName: string): Promise<TestResult> {
  const providerDef = providerRegistry.get(providerName);

  if (providerDef?.cli) {
    return testWithAdapter(cwd, providerName);
  }

  return {
    ok: false,
    checks: [{
      name: `${providerName}_provider`,
      passed: false,
      message: "CLI provider is not registered",
    }],
  };
}

/**
 * Unified built-in CLI test through Runtime discovery and the SDK probe plan.
 */
async function testWithAdapter(
  cwd: string,
  providerName: string,
): Promise<TestResult> {
  const checks: TestCheck[] = [];
  const provider = providerRegistry.get(providerName);
  if (!provider?.cli) return { ok: false, checks };
  const builtIn = {
    id: provider.name,
    agentFieldValue: provider.agentFieldValue,
    plugin: provider.cli.plugin,
  };
  const command = provider.cli.plugin.manifest.command.default;
  const env = providerBaseEnvironment(providerName);
  const resolution = await resolveBuiltInCommandResolution(builtIn, cwd).catch(() => null);
  const selected = resolution?.selected;

  // Check 1: command resolvable
  if (selected && (selected.state === "runnable" || selected.state === "connected")) {
    checks.push({
      name: `${providerName}_command_resolvable`,
      passed: true,
      message: `${command} command found and runnable`,
    });
  } else {
    checks.push({
      name: `${providerName}_command_resolvable`,
      passed: false,
      message: sanitizeDiagnostic(selected?.diagnostic ?? `${command} command not found or not executable`),
    });
    return { ok: false, checks };
  }

  checks.push({
    name: `${providerName}_version`,
    passed: true,
    message: selected.version ? `Version: ${selected.version}` : "Version: unknown",
  });

  const dependency = evaluateCliDependency(provider.cli.plugin.manifest, selected.path, selected.version);
  if (dependency.state !== "ready") {
    checks.push({
      name: `${providerName}_version_compatibility`,
      passed: false,
      message: dependency.state === "version-incompatible"
        ? `Detected CLI version is incompatible with ${dependency.supportedVersions}`
        : "CLI version could not be verified",
    });
    return { ok: false, checks };
  }

  // Authentication remains owned by the CLI; Tower never reads or reports credential values.
  checks.push({
    name: `${providerName}_cli_auth`,
    passed: true,
    message: `Authentication is managed by ${command}`,
  });

  const adapter = createBuiltInAdapter(builtIn, selected.path);
  if (!adapter.buildHelloProbe) {
    checks.push({
      name: `${providerName}_hello_probe`,
      passed: false,
      message: `${command} provider does not support an active hello probe`,
    });
    return { ok: false, checks };
  }
  const probeSpec = adapter.buildHelloProbe({
    command: selected.path,
    cwd,
    prompt: "Respond with just the word hello",
  });
  try {
    const probe = await new ControlledProcessExecutor({ env }).execute(probeSpec, {
      timeoutMs: 45_000,
      maxOutputBytes: MAX_CAPTURE_BYTES,
    });

    if ((probe.exitCode ?? 1) === 0) {
      const output = probe.stdout.trim();
      const assistantText = extractAssistantText(output);
      const replyText = sanitizeDiagnostic((assistantText || output).trim());
      // Pass as long as the model actually responded with text. Earlier
      // versions required a literal "hello", but real models freely say
      // "Hey!" / "Sure!" / "Hi there" — locking those out was just noise
      // around a CLI that genuinely works. Codex `exec` may also return plain
      // stdout instead of stream-json, so fall back to the raw successful output.
      const passed = replyText.length > 0;
      checks.push({
        name: `${providerName}_hello_probe`,
        passed,
        message: passed
          ? `${command} hello probe succeeded (model replied: ${replyText.slice(0, 80)})`
          : sanitizeDiagnostic(buildProbeMismatchMessage(command, output)),
      });
    } else {
      const stderrLine =
        probe.stderr
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find(Boolean) ?? "";
      checks.push({
        name: `${providerName}_hello_probe`,
        passed: false,
        message: stderrLine
          ? `${command} hello probe failed: ${sanitizeDiagnostic(stderrLine)}`
          : `${command} hello probe failed with exit code ${probe.exitCode ?? -1}`,
      });
    }
  } catch (err) {
    checks.push({
      name: `${providerName}_hello_probe`,
      passed: false,
      message: err instanceof Error
        ? sanitizeDiagnostic(err.message)
        : `${command} hello probe threw an error`,
    });
  }

  const ok = checks.every((c) => c.passed);
  return { ok, checks };
}
