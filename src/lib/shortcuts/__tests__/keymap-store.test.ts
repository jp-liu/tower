import { describe, it, expect, beforeEach } from "vitest";
import {
  useKeymapStore,
  resolveKeysFrom,
} from "@/stores/keymap-store";
import { getAction } from "../keymap";

const STORAGE_KEY = "tower-keymap-overrides";

function reset() {
  window.localStorage.clear();
  useKeymapStore.setState({ overrides: {} });
}

describe("resolveKeysFrom", () => {
  it("returns the action default when there is no override", () => {
    const keys = resolveKeysFrom({}, "global.search");
    expect(keys).toEqual([...getAction("global.search").defaultKeys]);
  });

  it("returns the override when one is set", () => {
    const keys = resolveKeysFrom({ "global.search": ["$mod+j"] }, "global.search");
    expect(keys).toEqual(["$mod+j"]);
  });

  it("returns a fresh array copy of the defaults (no shared mutation)", () => {
    const keys = resolveKeysFrom({}, "global.search");
    keys.push("hacked");
    expect([...getAction("global.search").defaultKeys]).toEqual(["$mod+k"]);
  });
});

describe("keymap-store", () => {
  beforeEach(reset);

  it("resolveKeys falls back to the default", () => {
    expect(useKeymapStore.getState().resolveKeys("global.commandPalette")).toEqual(
      ["$mod+p"]
    );
  });

  it("setBinding overrides and persists to localStorage", () => {
    useKeymapStore.getState().setBinding("global.search", ["$mod+j"]);
    expect(useKeymapStore.getState().resolveKeys("global.search")).toEqual([
      "$mod+j",
    ]);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw && JSON.parse(raw)).toEqual({ "global.search": ["$mod+j"] });
  });

  it("resetBinding reverts to the default and persists", () => {
    const store = useKeymapStore.getState();
    store.setBinding("global.search", ["$mod+j"]);
    store.resetBinding("global.search");
    expect(useKeymapStore.getState().resolveKeys("global.search")).toEqual([
      "$mod+k",
    ]);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw && JSON.parse(raw)).toEqual({});
  });

  it("resetBinding is a no-op for an un-overridden action", () => {
    useKeymapStore.getState().resetBinding("global.help");
    expect(useKeymapStore.getState().overrides).toEqual({});
  });

  it("resetAll clears every override and persists", () => {
    const store = useKeymapStore.getState();
    store.setBinding("global.search", ["$mod+j"]);
    store.setBinding("global.commandPalette", ["$mod+o"]);
    store.resetAll();
    expect(useKeymapStore.getState().overrides).toEqual({});
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw && JSON.parse(raw)).toEqual({});
  });

  it("setBinding performs an immutable update of the overrides map", () => {
    const before = useKeymapStore.getState().overrides;
    useKeymapStore.getState().setBinding("global.search", ["$mod+j"]);
    const after = useKeymapStore.getState().overrides;
    expect(after).not.toBe(before);
    expect(before).toEqual({});
  });
});
