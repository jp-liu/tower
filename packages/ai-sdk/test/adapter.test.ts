import { describe, expect, it } from "vitest";
import {
  CLI_PLUGIN_EXPORT_NAME,
  CLI_PLUGIN_EXPORT_PATH,
  classifyCliQueryFailure,
  isCliAdapter,
  isCliPlugin,
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
});
