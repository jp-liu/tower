export type TerminalClientInput =
  | { type: "input"; data: string }
  | { type: "submit"; data: string }
  | { type: "resize"; cols: number; rows: number };

/**
 * xterm's onData stream includes both keyboard input and terminal-generated
 * protocol replies. A standalone CR is the browser terminal's submit boundary;
 * all other bytes remain transport-only input.
 */
export function encodeTerminalClientInput(data: string): string {
  return JSON.stringify({
    type: data === "\r" ? "submit" : "input",
    data,
  } satisfies TerminalClientInput);
}

export function decodeTerminalClientInput(data: string): TerminalClientInput | null {
  if (!data.startsWith("{")) return null;
  try {
    const message = JSON.parse(data) as Partial<TerminalClientInput>;
    if ((message.type === "input" || message.type === "submit") && typeof message.data === "string") {
      return { type: message.type, data: message.data };
    }
    if (
      message.type === "resize"
      && typeof message.cols === "number"
      && typeof message.rows === "number"
    ) {
      return { type: "resize", cols: message.cols, rows: message.rows };
    }
  } catch {
    // Legacy/raw terminal input may begin with "{".
  }
  return null;
}
