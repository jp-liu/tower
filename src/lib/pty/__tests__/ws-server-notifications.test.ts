import { describe, it, expect, beforeEach, vi } from "vitest";

// Minimal fake WebSocket: only the fields broadcastNotification touches.
// readyState 1 === WebSocket.OPEN (from the "ws" package).
function makeFakeClient() {
  return {
    readyState: 1,
    sent: [] as string[],
    send(msg: string) {
      this.sent.push(msg);
    },
  };
}

describe("broadcastNotification cross-instance delivery", () => {
  beforeEach(() => {
    // Wipe the shared global registry between tests
    delete (globalThis as Record<string, unknown>).__notificationClients;
    vi.resetModules();
  });

  it("delivers to clients registered in a separate module instance (global Set shared)", async () => {
    // Instance A simulates the WS server module that accepts the browser
    // connection and registers it.
    const instanceA = await import("@/lib/pty/ws-server");
    const client = makeFakeClient();
    instanceA.addNotificationClient(client as unknown as import("ws").WebSocket);

    // Force a brand-new module instance — this is exactly what a standalone
    // build does when the API route handler loads ws-server separately from
    // the WS server. Before the fix each instance had its own module-level
    // `notificationClients` Set, so the route's broadcast hit an empty Set.
    vi.resetModules();
    const instanceB = await import("@/lib/pty/ws-server");
    expect(instanceB).not.toBe(instanceA);

    const payload = { type: "stop", taskId: "t1" };
    instanceB.broadcastNotification(payload);

    expect(client.sent).toEqual([JSON.stringify(payload)]);
  });

  it("does not send to closed clients", async () => {
    const mod = await import("@/lib/pty/ws-server");
    const open = makeFakeClient();
    const closed = makeFakeClient();
    closed.readyState = 3; // CLOSED
    mod.addNotificationClient(open as unknown as import("ws").WebSocket);
    mod.addNotificationClient(closed as unknown as import("ws").WebSocket);

    mod.broadcastNotification({ type: "stop" });

    expect(open.sent).toHaveLength(1);
    expect(closed.sent).toHaveLength(0);
  });

  it("removeNotificationClient stops further delivery", async () => {
    const mod = await import("@/lib/pty/ws-server");
    const client = makeFakeClient();
    mod.addNotificationClient(client as unknown as import("ws").WebSocket);
    mod.removeNotificationClient(client as unknown as import("ws").WebSocket);

    mod.broadcastNotification({ type: "stop" });

    expect(client.sent).toHaveLength(0);
  });
});
