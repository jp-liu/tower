import { describe, expect, it } from "vitest";
import { getExtensionMetadata } from "../metadata";
import { getTowerAgentGatewayDescriptor, towerAgentManifest } from "../tower-agent-manifest";

describe("Tower Agent extension manifest projection", () => {
  it("declares its renderer kind inside the extension manifest", () => {
    expect(towerAgentManifest.kind).toBe("gateway-adapter");
  });

  it.each([
    ["tower-agent-openclaw", "openclaw"],
    ["tower-agent-hermes", "hermes"],
  ] as const)("projects %s capabilities from its gateway target", (extensionId, gateway) => {
    const metadata = getExtensionMetadata(extensionId);
    expect(metadata?.kind).toBe(towerAgentManifest.kind);
    expect(metadata?.capabilities).toEqual(getTowerAgentGatewayDescriptor(gateway).capabilities);
  });
});
