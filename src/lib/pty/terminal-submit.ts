/**
 * Submit-key planning for programmatic terminal input (MCP / external orchestrators
 * such as the Feishu bot).
 *
 * Why this exists: the Claude Code TUI submits on a carriage return (CR, 0x0D) — the
 * browser xterm proves this, because pressing Enter there sends a *standalone* `\r`
 * keystroke that submits the input box. But when the message text and the `\r` arrive
 * glued together in a single write (e.g. `"hello\r"`), the TUI's paste-detection folds
 * the trailing `\r` into the text buffer as a literal newline instead of treating it as
 * Enter — the message fills the box but never submits.
 *
 * The fix is to deliver the submit key as a SEPARATE keystroke, mirroring the browser:
 * write the message body first, then write a lone `\r` a moment later. This module
 * decides what to write; the caller (the bridge route) handles the timing.
 */

export interface TerminalWritePlan {
  /** Message text to write immediately. Trailing CR/LF are stripped when submitting. */
  body: string;
  /** Standalone submit keystroke to deliver separately, or null when not submitting. */
  submitKey: "\r" | null;
}

/**
 * Decide how to write `text` to a PTY.
 *
 * - `submit = true` (default for callers): strip any trailing CR/LF the caller appended
 *   and submit via a standalone CR. Interior newlines are preserved.
 * - `submit = false`: forward the text verbatim with no submit (fill the box only).
 */
export function planTerminalWrite(text: string, submit: boolean): TerminalWritePlan {
  if (!submit) {
    return { body: text, submitKey: null };
  }
  return { body: text.replace(/[\r\n]+$/, ""), submitKey: "\r" };
}

/** Hex preview of the last `n` bytes of a string — for diagnosing what reached the PTY. */
export function hexTail(text: string, n = 8): string {
  const tail = text.slice(-n);
  return Array.from(tail)
    .map((ch) => ch.codePointAt(0)!.toString(16).padStart(2, "0"))
    .join(" ");
}
