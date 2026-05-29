import { describe, it, expect } from "vitest";
import {
  buildFileManagerCommand,
  buildEditorCommand,
  buildEditorUrlOpenCommand,
  ALLOWED_EDITOR_COMMANDS,
} from "@/lib/open-targets";
import { KNOWN_EDITORS } from "@/lib/platform";

describe("buildFileManagerCommand", () => {
  it("uses `open` on macOS", () => {
    expect(buildFileManagerCommand("darwin", "/Users/me/proj")).toEqual({
      command: "open",
      args: ["/Users/me/proj"],
    });
  });

  it("uses `explorer` on Windows", () => {
    expect(buildFileManagerCommand("win32", "C:\\Users\\me\\proj")).toEqual({
      command: "explorer",
      args: ["C:\\Users\\me\\proj"],
    });
  });

  it("uses `xdg-open` on Linux", () => {
    expect(buildFileManagerCommand("linux", "/home/me/proj")).toEqual({
      command: "xdg-open",
      args: ["/home/me/proj"],
    });
  });

  it("rejects a relative path", () => {
    expect(() => buildFileManagerCommand("darwin", "proj")).toThrow(/absolute/i);
  });

  it("rejects an empty path", () => {
    expect(() => buildFileManagerCommand("darwin", "")).toThrow(/absolute/i);
  });
});

describe("buildEditorCommand", () => {
  it("builds a CLI invocation for an allowed editor", () => {
    expect(buildEditorCommand("darwin", "code", "/Users/me/proj")).toEqual({
      command: "code",
      args: ["/Users/me/proj"],
    });
  });

  it("supports cursor", () => {
    expect(buildEditorCommand("darwin", "cursor", "/Users/me/proj")).toEqual({
      command: "cursor",
      args: ["/Users/me/proj"],
    });
  });

  it("every allowlisted command builds without throwing", () => {
    for (const cmd of ALLOWED_EDITOR_COMMANDS) {
      expect(buildEditorCommand("linux", cmd, "/home/me/p")).toEqual({
        command: cmd,
        args: ["/home/me/p"],
      });
    }
  });

  it("rejects a command not on the allowlist (no shell injection)", () => {
    expect(() => buildEditorCommand("darwin", "rm -rf /", "/Users/me/proj")).toThrow(
      /not allowed/i,
    );
  });

  it("rejects an unknown editor command", () => {
    expect(() => buildEditorCommand("darwin", "notepad-evil", "/Users/me/proj")).toThrow(
      /not allowed/i,
    );
  });

  it("rejects a relative path", () => {
    expect(() => buildEditorCommand("darwin", "code", "proj")).toThrow(/absolute/i);
  });
});

describe("buildEditorUrlOpenCommand (CLI-unavailable fallback)", () => {
  it("opens a vscode:// URL via `open` on macOS", () => {
    expect(buildEditorUrlOpenCommand("darwin", "code", "/Users/me/proj")).toEqual({
      command: "open",
      args: ["vscode://file/Users/me/proj"],
    });
  });

  it("maps code-insiders to the vscode-insiders scheme", () => {
    expect(
      buildEditorUrlOpenCommand("darwin", "code-insiders", "/Users/me/proj"),
    ).toEqual({
      command: "open",
      args: ["vscode-insiders://file/Users/me/proj"],
    });
  });

  it("opens a cursor:// URL via xdg-open on Linux", () => {
    expect(buildEditorUrlOpenCommand("linux", "cursor", "/home/me/p")).toEqual({
      command: "xdg-open",
      args: ["cursor://file/home/me/p"],
    });
  });

  it("opens the URL via rundll32 (no shell) on Windows with normalized slashes", () => {
    expect(
      buildEditorUrlOpenCommand("win32", "code", "C:\\Users\\me\\proj"),
    ).toEqual({
      command: "rundll32",
      args: ["url.dll,FileProtocolHandler", "vscode://file/C:/Users/me/proj"],
    });
  });

  it("throws for an allowlisted editor that has no URL scheme", () => {
    expect(() => buildEditorUrlOpenCommand("darwin", "subl", "/Users/me/p")).toThrow(
      /no url scheme/i,
    );
  });

  it("still enforces the allowlist", () => {
    expect(() => buildEditorUrlOpenCommand("darwin", "evil", "/Users/me/p")).toThrow(
      /not allowed/i,
    );
  });

  it("rejects a relative path", () => {
    expect(() => buildEditorUrlOpenCommand("darwin", "code", "proj")).toThrow(
      /absolute/i,
    );
  });
});

describe("editor list sync (drift guard)", () => {
  it("every detectable editor command is on the spawn allowlist", () => {
    const allowed = new Set<string>(ALLOWED_EDITOR_COMMANDS);
    const drifted = KNOWN_EDITORS.filter((e) => !allowed.has(e.command));
    expect(drifted.map((e) => e.command)).toEqual([]);
  });

  it("does not allowlist terminal-only editors (no GUI folder-open)", () => {
    expect(ALLOWED_EDITOR_COMMANDS).not.toContain("vim");
    expect(ALLOWED_EDITOR_COMMANDS).not.toContain("nvim");
    expect(ALLOWED_EDITOR_COMMANDS).not.toContain("emacs");
  });
});
