import { describe, expect, it } from "vitest";
import os from "node:os";
import { redactGatewayDiagnosticText } from "../gateway-runtime-health";

describe("gateway runtime diagnostics", () => {
  it("redacts credentials and local home paths before returning logs", () => {
    const input = [
      `config=${os.homedir()}/.openclaw/openclaw.json`,
      "Authorization: Bearer abc.def.ghi",
      "api_key=sk-super-secret-token",
      '"appSecret": "company-secret"',
      "token: plain-secret",
    ].join("\n");

    const output = redactGatewayDiagnosticText(input);

    expect(output).toContain("<HOME>/.openclaw/openclaw.json");
    expect(output).not.toContain(os.homedir());
    expect(output).not.toContain("abc.def.ghi");
    expect(output).not.toContain("sk-super-secret-token");
    expect(output).not.toContain("company-secret");
    expect(output).not.toContain("plain-secret");
  });
});
