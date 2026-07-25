// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { redactSecretString, redactSecretValue } from "../secret-redaction";

describe("secret redaction boundary", () => {
  const previous = process.env.TOWER_TEST_SECRET;

  afterEach(() => {
    if (previous === undefined) delete process.env.TOWER_TEST_SECRET;
    else process.env.TOWER_TEST_SECRET = previous;
  });

  it("redacts header, query, JSON, nested key, and configured environment canaries", () => {
    const envCanary = "CANARY_ENV_7d34a19f";
    process.env.TOWER_TEST_SECRET = envCanary;
    const value = {
      header: "Bearer CANARY_HEADER_2c17a981",
      url: "http://upstream.test/models?apiKey=CANARY_QUERY_3e28b492",
      body: '{"password":"CANARY_BODY_4f39c5a3"}',
      nested: { pluginToken: "CANARY_PLUGIN_5a40d6b4", safe: `prefix ${envCanary} suffix` },
    };

    const output = JSON.stringify(redactSecretValue(value));
    for (const canary of [
      "CANARY_HEADER_2c17a981",
      "CANARY_QUERY_3e28b492",
      "CANARY_BODY_4f39c5a3",
      "CANARY_PLUGIN_5a40d6b4",
      envCanary,
    ]) expect(output).not.toContain(canary);
    expect(output).toContain("[REDACTED]");
  });

  it("redacts credential assignments without changing ordinary text", () => {
    expect(redactSecretString("status=ok token=CANARY_ASSIGNMENT_6b51e7c5"))
      .toBe("status=ok token=[REDACTED]");
  });
});
