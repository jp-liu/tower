import { describe, expect, it } from "vitest";
import {
  BaseCliAdapter,
  CLI_PLUGIN_EXPORT_NAME,
  CLI_PLUGIN_EXPORT_PATH,
  classifyCliQueryFailure,
  isCliAdapter,
  isCliPlugin,
  streamProcessJsonLines,
  Utf8LineDecoder,
  type CliHostContext,
} from "../src/index.js";

describe("CLI plugin runtime guards", () => {
  it("publishes one standard provider entry and export", () => {
    expect(CLI_PLUGIN_EXPORT_PATH).toBe("./tower-cli-provider");
    expect(CLI_PLUGIN_EXPORT_NAME).toBe("towerCliPlugin");
  });

  it("rejects incomplete plugin and adapter shapes", () => {
    expect(isCliPlugin({ manifest: {}, createAdapter() {} })).toBe(false);
    expect(isCliAdapter({
      buildSessionProcess() {},
      buildHelloProbe() {},
      generate() {},
      models() {},
    })).toBe(true);
    // Probe support was added as a backwards-compatible v1 extension.
    expect(isCliAdapter({ buildSessionProcess() {}, generate() {}, models() {} })).toBe(true);
    expect(isCliAdapter({ buildSessionProcess() {}, buildHelloProbe: true, generate() {}, models() {} })).toBe(false);
  });

  it.each([
    ["401 unauthorized", "AUTHENTICATION_FAILED"],
    ["403 forbidden", "PERMISSION_DENIED"],
    ["429 rate limit exceeded", "RATE_LIMITED"],
    ["request timed out", "PROCESS_TIMEOUT"],
    ["model x is unavailable", "MODEL_NOT_AVAILABLE"],
    ["blocked by content safety policy", "CONTENT_SAFETY"],
    ["fetch failed: ECONNRESET", "NETWORK_ERROR"],
    ["bad request", "INVALID_REQUEST"],
    ["opaque provider failure", "PROVIDER_FAILURE"],
  ])("classifies one-shot failure %s as %s", (output, code) => {
    expect(classifyCliQueryFailure(output)).toBe(code);
  });

  it("keeps the Base stream compatible with generate-only plugins and separates tool results", async () => {
    class LegacyAdapter extends BaseCliAdapter {
      buildSessionProcess() { return { command: "legacy", args: [] }; }
      async generate() {
        return { text: "done", toolCalls: [{ id: "call-1", name: "legacy_tool", output: { ok: true } }] };
      }
      async models() { return []; }
    }
    const host = { logger: { debug() {}, info() {}, warn() {}, error() {} } } as unknown as CliHostContext;
    const events = [];
    for await (const event of new LegacyAdapter(host).stream({ prompt: "x" })) events.push(event);
    expect(events).toContainEqual({ type: "tool-result", toolResult: {
      id: "call-1", name: "legacy_tool", output: { ok: true },
    } });
  });

  it("decodes chunked UTF-8, CRLF, and an unterminated final JSONL line", async () => {
    const source = Buffer.from('{"text":"你好"}\r\nnot-json\n{"last":true}');
    const process = {
      execute: async () => ({ exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 0 }),
      stream: async function* () {
        for (let index = 0; index < source.length; index += 2) {
          yield { type: "stdout" as const, chunk: source.subarray(index, index + 2) };
        }
        yield { type: "exit" as const, exitCode: 0, signal: null, durationMs: 1 };
      },
    };
    const events = [];
    for await (const event of streamProcessJsonLines(process, { command: "fake", args: [] })) events.push(event);
    expect(events).toEqual([
      { type: "json", value: { text: "你好" } },
      { type: "malformed" },
      { type: "json", value: { last: true } },
      { type: "exit", exitCode: 0, signal: null, stderr: "" },
    ]);
  });

  it("rejects an oversized partial line without retaining its content", () => {
    const decoder = new Utf8LineDecoder(4);
    expect(() => decoder.push(Buffer.from("CANARY"))).toThrowError(expect.objectContaining({
      code: "PROCESS_OUTPUT_LIMIT",
      message: "Provider event exceeded the configured line limit",
    }));
  });
});
