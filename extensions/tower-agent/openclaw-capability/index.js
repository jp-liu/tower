import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { validateJsonSchemaValue } from "openclaw/plugin-sdk/json-schema-runtime";
import {
  buildOperatorMessage,
  normalizeCapabilityConfig,
  parseJobSubmission,
  publicDiscovery,
  sendCompletionCallback,
} from "./runtime.js";

function fail(respond, error) {
  respond(false, undefined, {
    code: "INVALID_REQUEST",
    message: error instanceof Error ? error.message : String(error),
  });
}

export default definePluginEntry({
  id: "tower-capability-bridge",
  name: "Tower Capability Bridge",
  description: "Maps Tower capability Jobs to private OpenClaw Operators.",
  register(api) {
    const entries = normalizeCapabilityConfig(api.pluginConfig);
    const callbacks = new Map();

    api.on("subagent_ended", async (event) => {
      const callback = callbacks.get(event.targetSessionKey);
      if (!callback) return;
      try {
        await sendCompletionCallback(callback, event);
        callbacks.delete(event.targetSessionKey);
      } catch (error) {
        api.logger.warn(
          `Tower capability completion callback failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    api.registerGatewayMethod("tower.capabilities.discover", ({ respond }) => {
      respond(true, {
        schemaVersion: 1,
        registryAuthority: "openclaw",
        capabilities: publicDiscovery(entries),
      });
    }, { scope: "operator.read" });

    api.registerGatewayMethod("tower.capabilities.submit", async ({ params, respond }) => {
      try {
        const request = parseJobSubmission(params, entries, validateJsonSchemaValue);
        const sessionKey = `agent:${request.entry.agentId}:subagent:tower-capability-${request.requestId}`;
        callbacks.set(sessionKey, { ...request.callback, requestId: request.requestId });
        const result = await api.runtime.subagent.run({
          sessionKey,
          message: buildOperatorMessage(request),
          extraSystemPrompt: request.entry.systemPrompt || undefined,
          deliver: false,
          idempotencyKey: `tower-capability:${request.requestId}`,
        });
        respond(true, {
          requestId: request.requestId,
          jobRef: result.runId,
          runId: result.runId,
          status: "ACCEPTED",
          revision: new Date().toISOString(),
        });
      } catch (error) {
        if (params && typeof params === "object" && typeof params.requestId === "string") {
          for (const [sessionKey, callback] of callbacks) {
            if (callback.requestId === params.requestId) callbacks.delete(sessionKey);
          }
        }
        fail(respond, error);
      }
    }, { scope: "operator.write" });
  },
});
