import { describe, it, expect, vi } from "vitest";
import { parseKeybinding } from "tinykeys";
import {
  resolveShortcut,
  isFormField,
  isModifierCombo,
} from "../shortcut-dispatcher";
import type { RegisteredShortcut, ShortcutBinding } from "../types";

let seq = 0;

/** Build a RegisteredShortcut from a partial binding (test helper). */
function makeEntry(
  keys: string | string[],
  overrides: Partial<ShortcutBinding> = {}
): RegisteredShortcut {
  seq += 1;
  const keyArr: string[] = Array.isArray(keys) ? keys : [keys];
  return {
    handler: vi.fn(),
    scope: "global",
    ...overrides,
    keys: keyArr,
    presses: keyArr.map((k) => parseKeybinding(k)),
    id: `e${seq}`,
    seq,
  };
}

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("isFormField", () => {
  it("returns true for INPUT / TEXTAREA / SELECT", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    expect(isFormField(input)).toBe(true);
    expect(isFormField(textarea)).toBe(true);
    expect(isFormField(select)).toBe(true);
  });

  it("returns true for contenteditable hosts", () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    // jsdom doesn't compute isContentEditable from the attribute; force it.
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isFormField(div)).toBe(true);
  });

  it("returns false for null and non-form elements", () => {
    expect(isFormField(null)).toBe(false);
    expect(isFormField(document.createElement("div"))).toBe(false);
  });

  it("treats xterm hidden textarea as a form field", () => {
    const ta = document.createElement("textarea");
    ta.className = "xterm-helper-textarea";
    expect(isFormField(ta)).toBe(true);
  });
});

describe("isModifierCombo", () => {
  it("true for Control / Meta / Alt combos", () => {
    expect(isModifierCombo(parseKeybinding("$mod+k")[0])).toBe(true);
    expect(isModifierCombo(parseKeybinding("Control+]")[0])).toBe(true);
    expect(isModifierCombo(parseKeybinding("Alt+x")[0])).toBe(true);
  });

  it("false for bare keys and Shift-only combos", () => {
    expect(isModifierCombo(parseKeybinding("1")[0])).toBe(false);
    expect(isModifierCombo(parseKeybinding("ArrowLeft")[0])).toBe(false);
    expect(isModifierCombo(parseKeybinding("Shift+Tab")[0])).toBe(false);
  });
});

describe("resolveShortcut — matching", () => {
  it("returns the matching entry for an exact bare key", () => {
    const entry = makeEntry("1");
    const hit = resolveShortcut([entry], keyEvent({ key: "1" }), false);
    expect(hit).toBe(entry);
  });

  it("matches modifier combos via $mod (Control in test env)", () => {
    // jsdom reports a non-mac platform, so $mod parses to Control.
    const entry = makeEntry("$mod+k");
    const hit = resolveShortcut(
      [entry],
      keyEvent({ key: "k", ctrlKey: true }),
      false
    );
    expect(hit).toBe(entry);
  });

  it("returns null when nothing matches", () => {
    const entry = makeEntry("$mod+k");
    const hit = resolveShortcut([entry], keyEvent({ key: "j" }), false);
    expect(hit).toBeNull();
  });

  it("ignores multi-press sequences in v1", () => {
    const entry = makeEntry("g g");
    const hit = resolveShortcut([entry], keyEvent({ key: "g" }), false);
    expect(hit).toBeNull();
  });
});

describe("resolveShortcut — scope priority", () => {
  it("missions scope beats global on the same key", () => {
    const global = makeEntry("Enter", { scope: "global" });
    const missions = makeEntry("Enter", { scope: "missions" });
    const hit = resolveShortcut(
      [global, missions],
      keyEvent({ key: "Enter" }),
      false
    );
    expect(hit).toBe(missions);
  });

  it("explicit priority wins within the same scope", () => {
    const low = makeEntry("a", { priority: 0 });
    const high = makeEntry("a", { priority: 5 });
    const hit = resolveShortcut([low, high], keyEvent({ key: "a" }), false);
    expect(hit).toBe(high);
  });

  it("later registration wins on a tie (seq desc)", () => {
    const first = makeEntry("b");
    const second = makeEntry("b");
    const hit = resolveShortcut([first, second], keyEvent({ key: "b" }), false);
    expect(hit).toBe(second);
  });
});

describe("resolveShortcut — form guard", () => {
  it("suppresses bare keys when a form field is focused", () => {
    const entry = makeEntry("1");
    const hit = resolveShortcut([entry], keyEvent({ key: "1" }), true);
    expect(hit).toBeNull();
  });

  it("allows bare keys with allowInInput when a form field is focused", () => {
    const entry = makeEntry("1", { allowInInput: true });
    const hit = resolveShortcut([entry], keyEvent({ key: "1" }), true);
    expect(hit).toBe(entry);
  });

  it("modifier combos bypass the guard", () => {
    const entry = makeEntry("$mod+[");
    const hit = resolveShortcut(
      [entry],
      keyEvent({ key: "[", ctrlKey: true }),
      true
    );
    expect(hit).toBe(entry);
  });

  it("modifier combos are blocked when allowInInput === false", () => {
    const entry = makeEntry("$mod+[", { allowInInput: false });
    const hit = resolveShortcut(
      [entry],
      keyEvent({ key: "[", ctrlKey: true }),
      true
    );
    expect(hit).toBeNull();
  });
});

describe("resolveShortcut — when gating", () => {
  it("drops a candidate whose when() returns false", () => {
    const entry = makeEntry("x", { when: () => false });
    const hit = resolveShortcut([entry], keyEvent({ key: "x" }), false);
    expect(hit).toBeNull();
  });

  it("keeps a candidate whose when() returns true", () => {
    const entry = makeEntry("x", { when: () => true });
    const hit = resolveShortcut([entry], keyEvent({ key: "x" }), false);
    expect(hit).toBe(entry);
  });
});
