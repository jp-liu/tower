import { CliPluginError } from "./errors.js";
import type {
  CliProcessExecutor,
  CliProcessRunOptions,
  CliProcessSpec,
} from "./process.js";

/** Incrementally decodes UTF-8 process output into bounded lines. */
export class Utf8LineDecoder {
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });
  private pending = "";

  constructor(private readonly maxLineBytes = 256 * 1024) {}

  push(chunk: Uint8Array): string[] {
    return this.consume(this.decoder.decode(chunk, { stream: true }), false);
  }

  finish(): string[] {
    return this.consume(this.decoder.decode(), true);
  }

  private consume(text: string, final: boolean): string[] {
    this.pending += text;
    const parts = this.pending.split("\n");
    this.pending = final ? "" : parts.pop() ?? "";
    if (final && parts.length === 1 && parts[0] === "") parts.pop();
    this.assertBounded(this.pending);
    return parts.map((line) => {
      const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
      this.assertBounded(normalized);
      return normalized;
    });
  }

  private assertBounded(value: string): void {
    if (new TextEncoder().encode(value).byteLength > this.maxLineBytes) {
      throw new CliPluginError("PROCESS_OUTPUT_LIMIT", "Provider event exceeded the configured line limit");
    }
  }
}

export type CliJsonLineEvent =
  | { type: "json"; value: unknown }
  | { type: "malformed" }
  | { type: "exit"; exitCode: number | null; signal: string | null; stderr: string };

/** Converts a Host process stream into bounded JSONL without exposing malformed content. */
export async function* streamProcessJsonLines(
  process: CliProcessExecutor,
  spec: CliProcessSpec,
  options: CliProcessRunOptions = {},
): AsyncIterable<CliJsonLineEvent> {
  if (!process.stream) {
    throw new CliPluginError("UNSUPPORTED_CAPABILITY", "The provider Host does not support process streaming");
  }
  const lines = new Utf8LineDecoder();
  const stderr = new TextDecoder();
  let stderrText = "";
  const parse = (line: string): CliJsonLineEvent | null => {
    if (!line.trim()) return null;
    try {
      return { type: "json", value: JSON.parse(line) };
    } catch {
      return { type: "malformed" };
    }
  };
  for await (const event of process.stream(spec, options)) {
    if (event.type === "stderr") {
      stderrText += stderr.decode(event.chunk, { stream: true });
      continue;
    }
    if (event.type === "stdout") {
      for (const line of lines.push(event.chunk)) {
        const parsed = parse(line);
        if (parsed) yield parsed;
      }
      continue;
    }
    for (const line of lines.finish()) {
      const parsed = parse(line);
      if (parsed) yield parsed;
    }
    stderrText += stderr.decode();
    yield { type: "exit", exitCode: event.exitCode, signal: event.signal, stderr: stderrText };
  }
}
