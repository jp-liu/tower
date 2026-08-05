import { createHash } from "node:crypto";

const CAPABILITY_NAME = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){2,7}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RISKS = new Set(["R0", "R1", "R2", "R3"]);
const VERIFIED_SENDER_ROLE_SCHEMA = "tower.openclaw_sender_role.v1";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function boundedString(value, max) {
  const result = typeof value === "string" ? value.trim() : "";
  return result && result.length <= max ? result : null;
}

function localCallback(value) {
  const row = object(value);
  const token = boundedString(row?.token, 128);
  const rawUrl = boundedString(row?.url, 500);
  if (!token || token.length < 32 || !rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "http:"
      || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
      || url.pathname !== "/api/internal/harness/capabilities/completions"
    ) return null;
    return { url: url.toString(), token };
  } catch {
    return null;
  }
}

export function buildVerifiedSenderRole(senderIsOwner) {
  return {
    schema: VERIFIED_SENDER_ROLE_SCHEMA,
    verified: typeof senderIsOwner === "boolean",
    sender_is_owner: typeof senderIsOwner === "boolean" ? senderIsOwner : null,
  };
}

export function normalizeCapabilityConfig(value) {
  const root = object(value) ?? {};
  const rows = Array.isArray(root.capabilities) ? root.capabilities : [];
  const seen = new Set();
  return rows.flatMap((value) => {
    const row = object(value);
    if (!row) return [];
    const name = boundedString(row.name, 128);
    const description = boundedString(row.description, 500);
    const agentId = boundedString(row.agentId, 128);
    const risk = boundedString(row.risk, 2);
    const inputSchema = object(row.inputSchema);
    const outputSchema = object(row.outputSchema) ?? {
      type: "object",
      additionalProperties: true,
    };
    const systemPrompt = boundedString(row.systemPrompt, 4000);
    if (
      !name || !CAPABILITY_NAME.test(name) || seen.has(name)
      || !description || !agentId || !risk || !RISKS.has(risk) || !inputSchema
    ) return [];
    seen.add(name);
    const routeRevision = createHash("sha256")
      .update(JSON.stringify({ name, agentId, risk, inputSchema, outputSchema }))
      .digest("hex");
    return [{ name, description, agentId, risk, inputSchema, outputSchema, systemPrompt, routeRevision }];
  });
}

export function publicDiscovery(entries) {
  return entries.map(({ name, description, risk, inputSchema, outputSchema, routeRevision }) => ({
    capability: name,
    description,
    lane: "JOB",
    risk,
    available: true,
    availability: "CONFIGURED",
    gateway: "openclaw",
    routeRevision,
    inputSchema,
    outputSchema,
  }));
}

export function parseJobSubmission(value, entries, validateSchema) {
  const row = object(value);
  if (!row) throw new Error("request params must be an object");
  const requestId = boundedString(row.requestId, 64);
  const capability = boundedString(row.capability, 128);
  const inputs = object(row.inputs);
  const towerContext = object(row.towerContext);
  const taskId = boundedString(towerContext?.taskId, 128);
  const projectId = boundedString(towerContext?.projectId, 128);
  const callback = localCallback(row.callback);
  if (!requestId || !UUID.test(requestId)) throw new Error("requestId must be a UUID");
  if (!capability || !inputs || !taskId || !callback) {
    throw new Error("capability, inputs, towerContext.taskId, and a local callback are required");
  }
  const entry = entries.find((item) => item.name === capability);
  if (!entry) throw new Error(`capability is not configured: ${capability}`);
  if (typeof validateSchema !== "function") throw new Error("capability schema validator is unavailable");
  const validation = validateSchema({
    schema: entry.inputSchema,
    cacheKey: `tower-capability:${entry.routeRevision}:input`,
    value: inputs,
  });
  if (!validation?.ok) {
    const detail = Array.isArray(validation?.errors)
      ? validation.errors.map((error) => error.text || error.message).filter(Boolean).join("; ")
      : "invalid inputs";
    throw new Error(`Capability inputs do not match the advertised schema: ${detail || "invalid inputs"}`);
  }
  return { requestId, capability, inputs, taskId, projectId, callback, entry };
}

export async function sendCompletionCallback(callback, event, fetchImpl = fetch) {
  const runId = boundedString(event?.runId, 256);
  if (!runId) throw new Error("subagent completion is missing runId");
  const response = await fetchImpl(callback.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${callback.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ requestId: callback.requestId, runId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Tower completion callback failed with HTTP ${response.status}`);
}

export function buildOperatorMessage(request) {
  return [
    "Execute one structured external capability Job for Tower.",
    `Capability: ${request.capability}`,
    `Request ID: ${request.requestId}`,
    `Tower task: ${request.taskId}`,
    request.projectId ? `Tower project: ${request.projectId}` : null,
    "Inputs:",
    JSON.stringify(request.inputs, null, 2),
    "Return a concise business summary and evidence references. Do not mutate Tower project/task state.",
  ].filter(Boolean).join("\n");
}
