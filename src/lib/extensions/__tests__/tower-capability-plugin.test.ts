// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The shipped OpenClaw plugin is plain ESM JavaScript so it can be copied into
// OpenClaw without a Tower build step.
import {
  buildOperatorMessage,
  buildVerifiedSenderRole,
  normalizeCapabilityConfig,
  parseJobSubmission,
  publicDiscovery,
  sendCompletionCallback,
} from "../../../../extensions/tower-agent/openclaw-capability/runtime.js";

const requestId = "4cc2791f-fbc9-47af-b410-4bd0586ae941";
const callback = {
  url: "http://127.0.0.1:3000/api/internal/harness/capabilities/completions",
  token: "callback_token_with_at_least_thirty_two_chars",
};
const validateSchema = ({ schema, value }: { schema: object; value: unknown }) => {
  const validate = new Ajv({ strict: false }).compile(schema);
  return validate(value)
    ? { ok: true, value }
    : { ok: false, errors: validate.errors?.map((error) => ({ text: error.message })) ?? [] };
};

describe("Tower OpenClaw capability plugin contract", () => {
  it("represents only OpenClaw's verified sender role", () => {
    expect(buildVerifiedSenderRole(true)).toEqual({
      schema: "tower.openclaw_sender_role.v1",
      verified: true,
      sender_is_owner: true,
    });
    expect(buildVerifiedSenderRole(false).sender_is_owner).toBe(false);
    expect(buildVerifiedSenderRole(undefined)).toMatchObject({
      verified: false,
      sender_is_owner: null,
    });
  });

  it("reads the owner decision directly from the trusted tool context", () => {
    const source = readFileSync(fileURLToPath(new URL(
      "../../../../extensions/tower-agent/openclaw-capability/index.js",
      import.meta.url,
    )), "utf8");
    expect(source).toContain("api.registerTool((ctx)");
    expect(source).toContain("buildVerifiedSenderRole(ctx.senderIsOwner)");
    expect(source).toContain('const VERIFIED_SENDER_ROLE_TOOL = "tower_sender_role"');
    expect(source).not.toContain('api.on("inbound_claim"');
    expect(source).not.toContain('api.on("agent_turn_prepare"');
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL(
      "../../../../extensions/tower-agent/openclaw-capability/openclaw.plugin.json",
      import.meta.url,
    )), "utf8")) as { contracts?: { tools?: string[] } };
    expect(manifest.contracts?.tools).toContain("tower_sender_role");
  });

  it("shares pending callbacks across OpenClaw runtime scopes", () => {
    const source = readFileSync(fileURLToPath(new URL(
      "../../../../extensions/tower-agent/openclaw-capability/index.js",
      import.meta.url,
    )), "utf8");
    const registry = source.indexOf("const callbacks = new Map();");
    const registration = source.indexOf("export default definePluginEntry");
    expect(registry).toBeGreaterThan(-1);
    expect(registry).toBeLessThan(registration);
    expect(source.slice(registration)).not.toContain("const callbacks = new Map();");
  });

  it("keeps concrete Operator ids private during discovery", () => {
    const entries = normalizeCapabilityConfig({
      capabilities: [{
        name: "computer.gui.act",
        description: "Operate the desktop",
        agentId: "private-computer-operator",
        risk: "R2",
        inputSchema: { type: "object", required: ["instruction"] },
      }],
    });
    const discovery = publicDiscovery(entries);
    expect(discovery).toEqual([expect.objectContaining({
      capability: "computer.gui.act",
      lane: "JOB",
      risk: "R2",
      routeRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
    })]);
    expect(JSON.stringify(discovery)).not.toContain("private-computer-operator");
  });

  it("rejects unknown capabilities and builds a structured Operator prompt", () => {
    const entries = normalizeCapabilityConfig({
      capabilities: [{
        name: "computer.gui.act",
        description: "Operate the desktop",
        agentId: "computer-operator",
        risk: "R2",
        inputSchema: { type: "object" },
      }],
    });
    expect(() => parseJobSubmission({
      requestId,
      capability: "computer.gui.unknown",
      inputs: {},
      towerContext: { taskId: "task-1" },
      callback,
    }, entries, validateSchema)).toThrow("not configured");

    const request = parseJobSubmission({
      requestId,
      capability: "computer.gui.act",
      inputs: { instruction: "Open the report" },
      towerContext: { taskId: "task-1", projectId: "project-1" },
      callback,
    }, entries, validateSchema);
    expect(buildOperatorMessage(request)).toContain("Open the report");
    expect(buildOperatorMessage(request)).not.toContain("computer-operator");
  });

  it("accepts only local callbacks and never posts a claimed outcome", async () => {
    const entries = normalizeCapabilityConfig({
      capabilities: [{
        name: "computer.gui.act",
        description: "Operate the desktop",
        agentId: "computer-operator",
        risk: "R2",
        inputSchema: { type: "object" },
      }],
    });
    expect(() => parseJobSubmission({
      requestId,
      capability: "computer.gui.act",
      inputs: {},
      towerContext: { taskId: "task-1" },
      callback: { ...callback, url: "https://attacker.example/callback" },
    }, entries, validateSchema)).toThrow(/local callback/);

    expect(() => parseJobSubmission({
      requestId,
      capability: "computer.gui.act",
      inputs: { extra: true },
      towerContext: { taskId: "task-1" },
      callback,
    }, normalizeCapabilityConfig({
      capabilities: [{
        name: "computer.gui.act",
        description: "Operate the desktop",
        agentId: "computer-operator",
        risk: "R2",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["instruction"],
          properties: { instruction: { type: "string" } },
        },
      }],
    }), validateSchema)).toThrow(/advertised schema/);

    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    await sendCompletionCallback(
      { ...callback, requestId },
      { runId: "run-1", outcome: "ok" },
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith(callback.url, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: `Bearer ${callback.token}` }),
      body: JSON.stringify({ requestId, runId: "run-1" }),
    }));
    expect(fetchImpl.mock.calls[0]?.[1]?.body).not.toContain("outcome");
  });
});
