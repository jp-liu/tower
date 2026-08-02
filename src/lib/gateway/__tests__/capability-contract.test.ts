// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  capabilityEnvelopeDigest,
  capabilityRequestSchema,
} from "../capability-contract";

function envelope() {
  return {
    schemaVersion: 1 as const,
    requestId: "5aa1ee1a-f6d7-48a7-a9eb-e624122fc931",
    capability: "human.message.send" as const,
    lane: "DIRECT" as const,
    risk: "R2" as const,
    authorizationRef: "grant-1",
    inputs: { message: "Need a decision", expectReply: true },
    expectedOutput: { summary: true, evidence: [] },
    towerContext: { taskId: "task-1", projectId: "project-1" },
    constraints: ["owner home route only"],
  };
}

describe("CapabilityRequest v1 contract", () => {
  it("accepts the bounded OWNER message envelope and derives a stable digest", () => {
    const parsed = capabilityRequestSchema.parse(envelope());
    expect(capabilityEnvelopeDigest(parsed)).toMatch(/^[a-f0-9]{64}$/);
    expect(capabilityEnvelopeDigest(parsed)).toBe(capabilityEnvelopeDigest(parsed));
  });

  it("does not allow the caller to inject a destination or downgrade risk", () => {
    expect(() => capabilityRequestSchema.parse({
      ...envelope(),
      inputs: { ...envelope().inputs, to: "third-party" },
    })).toThrow();
    expect(() => capabilityRequestSchema.parse({ ...envelope(), risk: "R0" })).toThrow();
    expect(() => capabilityRequestSchema.parse({ ...envelope(), lane: "JOB" })).toThrow();
  });
});
