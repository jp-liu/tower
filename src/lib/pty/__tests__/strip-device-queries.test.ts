import { describe, it, expect } from "vitest";
import { stripDeviceQueries } from "../strip-device-queries";

const ESC = "\x1b";
const BEL = "\x07";
const ST = "\x1b\\";

describe("stripDeviceQueries", () => {
  it("returns empty/falsy input unchanged", () => {
    expect(stripDeviceQueries("")).toBe("");
  });

  it("leaves plain text untouched", () => {
    const text = "Hello, world!\nsecond line\tindented";
    expect(stripDeviceQueries(text)).toBe(text);
  });

  it("removes Device Attributes requests (DA1/DA2/DA3)", () => {
    expect(stripDeviceQueries(`${ESC}[c`)).toBe("");
    expect(stripDeviceQueries(`${ESC}[0c`)).toBe("");
    expect(stripDeviceQueries(`${ESC}[>c`)).toBe("");
    expect(stripDeviceQueries(`${ESC}[>0c`)).toBe("");
    expect(stripDeviceQueries(`${ESC}[=c`)).toBe("");
  });

  it("removes Device Status Report / cursor-position requests", () => {
    expect(stripDeviceQueries(`${ESC}[5n`)).toBe(""); // status
    expect(stripDeviceQueries(`${ESC}[6n`)).toBe(""); // cursor position
    expect(stripDeviceQueries(`${ESC}[?6n`)).toBe(""); // DECXCPR
    expect(stripDeviceQueries(`${ESC}[?15n`)).toBe(""); // printer status
  });

  it("removes DECRQM (request mode) requests", () => {
    expect(stripDeviceQueries(`${ESC}[?2004$p`)).toBe("");
    expect(stripDeviceQueries(`${ESC}[?1049$p`)).toBe("");
    expect(stripDeviceQueries(`${ESC}[4$p`)).toBe("");
  });

  it("removes XTVERSION requests", () => {
    expect(stripDeviceQueries(`${ESC}[>q`)).toBe("");
    expect(stripDeviceQueries(`${ESC}[>0q`)).toBe("");
  });

  it("removes XTWINOPS report requests but keeps set/manipulation ops", () => {
    // Report requests (14 = text-area pixel size, 18 = char size, 11 = state)
    expect(stripDeviceQueries(`${ESC}[14t`)).toBe("");
    expect(stripDeviceQueries(`${ESC}[18t`)).toBe("");
    expect(stripDeviceQueries(`${ESC}[11t`)).toBe("");
    expect(stripDeviceQueries(`${ESC}[14;2t`)).toBe("");
    // SET ops must survive: iconify(2), move(3;x;y), resize-in-chars(8;r;c), fullscreen(10)
    expect(stripDeviceQueries(`${ESC}[2t`)).toBe(`${ESC}[2t`);
    expect(stripDeviceQueries(`${ESC}[3;10;20t`)).toBe(`${ESC}[3;10;20t`);
    expect(stripDeviceQueries(`${ESC}[8;24;80t`)).toBe(`${ESC}[8;24;80t`);
    expect(stripDeviceQueries(`${ESC}[10t`)).toBe(`${ESC}[10t`);
  });

  it("removes OSC color / palette queries", () => {
    expect(stripDeviceQueries(`${ESC}]10;?${BEL}`)).toBe("");
    expect(stripDeviceQueries(`${ESC}]11;?${BEL}`)).toBe("");
    expect(stripDeviceQueries(`${ESC}]4;1;?${ST}`)).toBe("");
    // A real OSC that SETS a color (no trailing '?') must survive.
    expect(stripDeviceQueries(`${ESC}]11;rgb:0000/0000/0000${BEL}`)).toBe(
      `${ESC}]11;rgb:0000/0000/0000${BEL}`
    );
  });

  it("removes DECRQSS / XTGETTCAP requests", () => {
    expect(stripDeviceQueries(`${ESC}P$qm${ST}`)).toBe(""); // DECRQSS (SGR)
    expect(stripDeviceQueries(`${ESC}P+q544e${ST}`)).toBe(""); // XTGETTCAP
  });

  it("does not touch SGR color, cursor moves, or other visible control sequences", () => {
    const keep = [
      `${ESC}[31m`, // red foreground (ends in m)
      `${ESC}[0m`, // reset
      `${ESC}[2J`, // clear screen (ends in J) — display op, not a query
      `${ESC}[H`, // cursor home
      `${ESC}[10;5H`, // cursor position SET
      `${ESC}[?25h`, // show cursor (SET mode, ends in h)
      `${ESC}[?25l`, // hide cursor
      `${ESC}[1;2004h`, // set modes
    ];
    for (const seq of keep) {
      expect(stripDeviceQueries(seq)).toBe(seq);
    }
  });

  it("strips queries embedded in a realistic mixed stream while preserving the render", () => {
    const stream =
      `${ESC}[2J${ESC}[H` + // clear + home (keep)
      `Claude Code ${ESC}[6n` + // visible text + cursor query (strip query)
      `${ESC}[38;5;208mtower${ESC}[0m` + // colored text (keep)
      `${ESC}[c` + // DA request (strip)
      `\n> ` + // prompt (keep)
      `${ESC}[?2004$p`; // DECRQM (strip)

    const result = stripDeviceQueries(stream);

    // No query request survives.
    expect(result).not.toContain(`${ESC}[6n`);
    expect(result).not.toContain(`${ESC}[c`);
    expect(result).not.toContain("$p");
    // Everything visible / display-affecting survives.
    expect(result).toBe(
      `${ESC}[2J${ESC}[H` +
        `Claude Code ` +
        `${ESC}[38;5;208mtower${ESC}[0m` +
        `\n> `
    );
  });

  it("removes repeated cursor-position queries (Ink re-render pattern)", () => {
    // Ink-based TUIs emit CSI 6 n on many renders; the ring buffer fills with them.
    const noisy = "line1\n" + `${ESC}[6n`.repeat(50) + "line2\n" + `${ESC}[6n`.repeat(50);
    const result = stripDeviceQueries(noisy);
    expect(result).toBe("line1\nline2\n");
    expect(result).not.toContain(`${ESC}[6n`);
  });
});
