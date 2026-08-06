import { describe, expect, it, vi } from "vitest";
import { forwardTerminalClientMessage } from "../ws-server";
import { encodeTerminalClientInput } from "../ws-input-protocol";

function target() {
  return {
    resize: vi.fn(),
    writeRaw: vi.fn(),
    writeSubmittedInput: vi.fn(),
  };
}

describe("PTY WebSocket input boundaries", () => {
  it.each(["\x1b[I", "\x1b[O", "\x1b[12;40R", "\x1b[?1;2c"])(
    "forwards xterm protocol bytes without declaring a semantic submit: %j",
    (data) => {
      const session = target();

      forwardTerminalClientMessage(session, encodeTerminalClientInput(data));

      expect(session.writeRaw).toHaveBeenCalledWith(data);
      expect(session.writeSubmittedInput).not.toHaveBeenCalled();
    },
  );

  it("marks a standalone browser Enter as submitted semantic input", () => {
    const session = target();

    forwardTerminalClientMessage(session, encodeTerminalClientInput("\r"));

    expect(session.writeSubmittedInput).toHaveBeenCalledWith("\r");
    expect(session.writeRaw).not.toHaveBeenCalled();
  });

  it("keeps legacy raw frames compatible without treating ordinary bytes as submitted", () => {
    const session = target();

    forwardTerminalClientMessage(session, "typed text");
    forwardTerminalClientMessage(session, "\r");

    expect(session.writeRaw).toHaveBeenCalledWith("typed text");
    expect(session.writeSubmittedInput).toHaveBeenCalledWith("\r");
  });
});
