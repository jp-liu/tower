import { describe, it, expect, beforeEach, vi } from "vitest";

// Control isMac() via a hoisted mock so we can exercise both platform paths.
const { mockIsMac } = vi.hoisted(() => ({ mockIsMac: vi.fn(() => false) }));
vi.mock("../use-shortcut-help", () => ({ isMac: mockIsMac }));

import { serializeKeyEvent } from "../serialize-keys";

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("serializeKeyEvent", () => {
  beforeEach(() => {
    mockIsMac.mockReturnValue(false);
  });

  it("maps the command modifier to $mod (ctrl path on non-mac)", () => {
    // jsdom reports a non-mac platform → ctrlKey is the command modifier.
    expect(serializeKeyEvent(keyEvent({ key: "k", ctrlKey: true }))).toBe(
      "$mod+k"
    );
  });

  it("maps metaKey+k to $mod+k on the mac path", () => {
    mockIsMac.mockReturnValue(true);
    expect(serializeKeyEvent(keyEvent({ key: "k", metaKey: true }))).toBe(
      "$mod+k"
    );
  });

  it("emits literal Control on the mac path (ctrlKey is not command there)", () => {
    mockIsMac.mockReturnValue(true);
    expect(serializeKeyEvent(keyEvent({ key: ";", ctrlKey: true }))).toBe(
      "Control+;"
    );
  });

  it("serializes Shift+Tab with the bare key verbatim", () => {
    expect(serializeKeyEvent(keyEvent({ key: "Tab", shiftKey: true }))).toBe(
      "Shift+Tab"
    );
  });

  it("orders modifiers $mod, other, Alt, Shift then key", () => {
    mockIsMac.mockReturnValue(true);
    const out = serializeKeyEvent(
      keyEvent({ key: "k", metaKey: true, ctrlKey: true, altKey: true, shiftKey: true })
    );
    expect(out).toBe("$mod+Control+Alt+Shift+k");
  });

  it("keeps non-letter keys verbatim", () => {
    expect(serializeKeyEvent(keyEvent({ key: "ArrowLeft", ctrlKey: true }))).toBe(
      "$mod+ArrowLeft"
    );
  });

  it("returns null for a bare modifier press", () => {
    expect(serializeKeyEvent(keyEvent({ key: "Control", ctrlKey: true }))).toBeNull();
    expect(serializeKeyEvent(keyEvent({ key: "Shift", shiftKey: true }))).toBeNull();
    expect(serializeKeyEvent(keyEvent({ key: "Alt", altKey: true }))).toBeNull();
    expect(serializeKeyEvent(keyEvent({ key: "Meta", metaKey: true }))).toBeNull();
  });
});
