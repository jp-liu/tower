import type { Terminal, ILinkProvider, ILink, IBufferLine } from "@xterm/xterm";

/** A detected file link with path, position, and line/col info. */
export interface ParsedFileLink {
  path: string;
  startIndex: number;
  totalLength: number;
  line?: number;
  col?: number;
}

// Match relative file paths: ./foo.ts | src/foo.ts | foo/bar.tsx
const FILE_PATH_RE =
  /(?:\.\.?\/|[a-zA-Z0-9_@][a-zA-Z0-9_\-.]*\/)[a-zA-Z0-9_\-.\/@]+\.\w+/g;

// Line/col suffix: :line:col | (line,col) | [line, col]
const SUFFIX_RE =
  /^(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s*(\d+))?\)|\[(\d+)(?:,\s*(\d+))?\])/;

/** Parse file path links from a single line of terminal text. */
export function parseFileLinks(text: string): ParsedFileLink[] {
  const links: ParsedFileLink[] = [];
  FILE_PATH_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    const pathStr = match[0];
    const startIndex = match.index;

    const afterPath = text.slice(startIndex + pathStr.length);
    const suffixMatch = afterPath.match(SUFFIX_RE);

    let totalLength = pathStr.length;
    let fileLine: number | undefined;
    let fileCol: number | undefined;

    if (suffixMatch && suffixMatch.index === 0) {
      totalLength += suffixMatch[0].length;
      const rawLine = suffixMatch[1] ?? suffixMatch[3] ?? suffixMatch[5];
      const rawCol = suffixMatch[2] ?? suffixMatch[4] ?? suffixMatch[6];
      fileLine = rawLine ? parseInt(rawLine, 10) : undefined;
      fileCol = rawCol ? parseInt(rawCol, 10) : undefined;
    }

    links.push({ path: pathStr, startIndex, totalLength, line: fileLine, col: fileCol });
  }

  return links;
}

/**
 * Local file link provider for xterm.js terminals.
 *
 * Detects file paths in terminal output (e.g. src/foo.ts:42:10)
 * and makes them clickable, opening the file in the workbench editor.
 */
export class LocalFileLinkProvider implements ILinkProvider {
  constructor(
    private terminal: Terminal,
    private worktreePath: string,
    private onFileOpen: (fullPath: string, line?: number, col?: number) => void,
  ) {}

  provideLinks(
    lineNumber: number,
    callback: (links: ILink[] | undefined) => void,
  ): void {
    const bufferLine: IBufferLine | undefined =
      this.terminal.buffer.active.getLine(lineNumber);
    if (!bufferLine) return callback(undefined);

    const text = bufferLine.translateToString();
    const parsed = parseFileLinks(text);

    if (parsed.length === 0) return callback(undefined);

    const links: ILink[] = parsed.map((p) => ({
      range: {
        start: { x: p.startIndex + 1, y: lineNumber },
        end: { x: p.startIndex + p.totalLength + 1, y: lineNumber },
      },
      text: text.slice(p.startIndex, p.startIndex + p.totalLength),
      activate: () => {
        this.onFileOpen(`${this.worktreePath}/${p.path}`, p.line, p.col);
      },
    }));

    callback(links);
  }
}
