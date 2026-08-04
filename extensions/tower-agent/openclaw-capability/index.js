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

// OpenClaw may register the same plugin entry in more than one runtime scope.
// Completion hooks and gateway methods must therefore share one callback
// registry at module scope; a register-local Map loses the callback when the
// hook is invoked by a sibling runtime scope.
const callbacks = new Map();

export default definePluginEntry({
  id: "tower-capability-bridge",
  name: "Tower Capability Bridge",
  description: "Maps Tower capability Jobs to private OpenClaw Operators.",
  register(api) {
    const entries = normalizeCapabilityConfig(api.pluginConfig);

    api.on("subagent_ended", async (event) => {
      const callback = callbacks.get(event.targetSessionKey)
        || (event.runId ? callbacks.get(event.runId) : null);
      if (!callback) return;
      try {
        await sendCompletionCallback(callback, event);
      } catch (error) {
        api.logger.warn(
          `Tower capability completion callback failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        // Completion is emitted once. Tower's durable recovery scan owns any
        // retry, so do not retain callback bearer material in plugin memory.
        callbacks.delete(callback.sessionKey);
        if (event.runId) callbacks.delete(event.runId);
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
        const callback = { ...request.callback, requestId: request.requestId, sessionKey };
        callbacks.set(sessionKey, callback);
        const result = await api.runtime.subagent.run({
          sessionKey,
          message: buildOperatorMessage(request),
          extraSystemPrompt: request.entry.systemPrompt || undefined,
          deliver: false,
          idempotencyKey: `tower-capability:${request.requestId}`,
        });
        // Current OpenClaw completion events carry both a target session and a
        // durable run id. Index both so canonicalization differences cannot
        // silently drop the primary completion callback.
        callbacks.set(result.runId, callback);
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
