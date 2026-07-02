/**
 * strip-device-queries.ts — Neutralize terminal *query* sequences in replayed PTY output.
 *
 * ## Why this exists (severe data-loss bug)
 *
 * Tower's task terminal is a browser xterm.js instance connected to a node-pty
 * session. On every new WebSocket connection the server replays up to 50 KB of the
 * PTY's *past output* so the reconnecting terminal shows recent history
 * (`ws-server.ts` → `wireSession` → `ws.send(buffer)`).
 *
 * The problem: a TUI like the Claude CLI continuously emits **terminal query /
 * report-request escape sequences** — cursor-position report (`CSI 6 n`), Device
 * Attributes (`CSI c`), DECRQM (`CSI ? Ps $ p`), XTVERSION, window-size reports
 * (`CSI 14 t`), OSC color queries, DECRQSS/XTGETTCAP, etc. These land in the ring
 * buffer. When that buffer is replayed into a *fresh* xterm, xterm dutifully
 * **auto-answers each query** (that is standard, correct terminal behavior) and the
 * answer travels back out through `terminal.onData → ws.send → session.write()`
 * straight into the PTY as input the user never typed.
 *
 * Claude already received answers to these queries long ago; the replayed burst of
 * phantom answers hits its input / slash-command state machine and — in the wild —
 * has been observed to execute `/clear`, wiping the whole conversation context.
 * (Reproduce: open a long-running task's terminal, navigate away and back.)
 *
 * ## The fix
 *
 * Query *requests* produce **no visible output** — they exist only to elicit a
 * reply. So stripping them from the replay buffer is visually lossless and removes
 * the trigger entirely: xterm sees no query → sends no phantom answer → the PTY
 * gets no unsolicited input. Live PTY traffic is untouched, so genuine mid-session
 * queries still get answered normally.
 *
 * The patterns below mirror exactly the sequences xterm 6.0 replies to (every
 * `coreService.triggerDataEvent(...)` call in its input handlers). Focus reports
 * (`CSI I` / `CSI O`) are intentionally NOT covered here: they are emitted by real
 * browser focus/blur events, never appear in PTY output, and are legitimate.
 */

/**
 * Escape sequences that make xterm auto-reply to the PTY. Each is a *request* with
 * no on-screen rendering, so removing it from replayed output changes nothing the
 * user sees while eliminating the phantom-input reply.
 */
const DEVICE_QUERY_PATTERNS: readonly RegExp[] = [
  // Device Attributes (Primary/Secondary/Tertiary): CSI [<=>?]? <params> c
  // → xterm replies with e.g. ESC [ ? 1 ; 2 c
  /\x1b\[[<=>?]?[0-9;]*c/g,

  // Device Status Report / cursor-position report: CSI ?? <params> n
  // → xterm replies with ESC [ 0 n  or  ESC [ <row> ; <col> R
  /\x1b\[\??[0-9;]*n/g,

  // DECRQM (request DEC/ANSI mode): CSI ?? <params> $ p
  // → xterm replies with ESC [ ?? <mode> ; <value> $ y
  /\x1b\[\??[0-9;]*\$p/g,

  // XTVERSION: CSI > <params> q  (the '>' disambiguates from DECSCUSR "CSI Ps SP q")
  // → xterm replies with a DCS version string
  /\x1b\[>[0-9;]*q/g,

  // XTWINOPS *report* requests only — opcodes 11,13,14,15,16,18,19,20,21.
  // Window-manipulation SET ops (iconify/move/resize: opcodes 1–10) start with a
  // different digit and are deliberately left intact.
  /\x1b\[(?:1[1345689]|2[01])(?:;[0-9]+)*t/g,

  // OSC color / palette query: OSC <params> ; ? (BEL | ST)
  // → xterm replies with the current color. The trailing '?' marks it as a query.
  /\x1b\][0-9;]*;\?(?:\x07|\x1b\\)/g,

  // DECRQSS / XTGETTCAP: DCS ($ | +) q ... ST
  // → xterm replies with a DCS capability/setting string.
  /\x1bP[$+]q[\s\S]*?\x1b\\/g,
];

/**
 * Remove terminal query/report-request sequences from a chunk of replayed PTY
 * output. Returns the cleaned string; visible content is preserved byte-for-byte.
 *
 * Intended for **replay only** — never mutate live PTY traffic, which must keep
 * answering the app's real-time queries.
 */
export function stripDeviceQueries(data: string): string {
  if (!data) return data;
  let out = data;
  for (const pattern of DEVICE_QUERY_PATTERNS) {
    out = out.replace(pattern, "");
  }
  return out;
}
