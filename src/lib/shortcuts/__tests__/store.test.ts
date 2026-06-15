import { describe, it, expect, beforeEach, vi } from "vitest";
import { useShortcutStore, selectAllShortcuts } from "../shortcut-store";

function reset() {
  useShortcutStore.setState({ entries: new Map() });
}

describe("shortcut-store", () => {
  beforeEach(reset);

  it("register returns unique ids", () => {
    const { register } = useShortcutStore.getState();
    const id1 = register({ keys: "$mod+k", handler: vi.fn() });
    const id2 = register({ keys: "$mod+p", handler: vi.fn() });
    expect(id1).not.toBe(id2);
    expect(selectAllShortcuts(useShortcutStore.getState())).toHaveLength(2);
  });

  it("normalizes string keys to an array", () => {
    const { register } = useShortcutStore.getState();
    const id = register({ keys: "$mod+k", handler: vi.fn() });
    const entry = useShortcutStore.getState().entries.get(id);
    expect(entry?.keys).toEqual(["$mod+k"]);
  });

  it("keeps array keys as an array", () => {
    const { register } = useShortcutStore.getState();
    const id = register({ keys: ["1", "2", "3"], handler: vi.fn() });
    const entry = useShortcutStore.getState().entries.get(id);
    expect(entry?.keys).toEqual(["1", "2", "3"]);
  });

  it("caches parsed presses per key", () => {
    const { register } = useShortcutStore.getState();
    const id = register({ keys: ["1", "2"], handler: vi.fn() });
    const entry = useShortcutStore.getState().entries.get(id);
    expect(entry?.presses).toHaveLength(2);
    // Each press list is non-empty.
    expect(entry?.presses[0].length).toBeGreaterThan(0);
  });

  it("assigns an increasing seq to later registrations", () => {
    const { register } = useShortcutStore.getState();
    const id1 = register({ keys: "a", handler: vi.fn() });
    const id2 = register({ keys: "b", handler: vi.fn() });
    const e1 = useShortcutStore.getState().entries.get(id1)!;
    const e2 = useShortcutStore.getState().entries.get(id2)!;
    expect(e2.seq).toBeGreaterThan(e1.seq);
  });

  it("unregister removes the entry", () => {
    const { register, unregister } = useShortcutStore.getState();
    const id = register({ keys: "$mod+k", handler: vi.fn() });
    expect(useShortcutStore.getState().entries.has(id)).toBe(true);
    unregister(id);
    expect(useShortcutStore.getState().entries.has(id)).toBe(false);
  });

  it("unregister is a no-op for unknown ids", () => {
    const { register, unregister } = useShortcutStore.getState();
    register({ keys: "$mod+k", handler: vi.fn() });
    unregister("does-not-exist");
    expect(selectAllShortcuts(useShortcutStore.getState())).toHaveLength(1);
  });
});
