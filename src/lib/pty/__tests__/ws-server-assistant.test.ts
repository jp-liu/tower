import { describe, it } from "vitest";

describe("ws-server assistant handling", () => {
  it.todo("immediately destroys __assistant__ session on WS close (BE-05)");
  it.todo("does not set keepalive timer for __assistant__ sessions");
  it.todo("still applies keepalive for non-assistant sessions");
});
