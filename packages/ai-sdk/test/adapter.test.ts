import { describe, expect, it } from "vitest";
import {
  CLI_PLUGIN_EXPORT_NAME,
  CLI_PLUGIN_EXPORT_PATH,
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
});
