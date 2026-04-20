import { describe, it, expect } from "vitest";
import { parseFileLinks } from "../terminal-link-provider";

describe("parseFileLinks", () => {
  describe("path detection", () => {
    it("detects relative path with ./", () => {
      const links = parseFileLinks("error in ./src/foo.ts");
      expect(links).toHaveLength(1);
      expect(links[0].path).toBe("./src/foo.ts");
    });

    it("detects relative path with ../", () => {
      const links = parseFileLinks("see ../lib/utils.ts");
      expect(links).toHaveLength(1);
      expect(links[0].path).toBe("../lib/utils.ts");
    });

    it("detects path starting with directory name", () => {
      const links = parseFileLinks("FAIL src/components/button.tsx");
      expect(links).toHaveLength(1);
      expect(links[0].path).toBe("src/components/button.tsx");
    });

    it("detects path with @ scope", () => {
      const links = parseFileLinks("import from @/lib/utils.ts");
      expect(links).toHaveLength(1);
      expect(links[0].path).toBe("@/lib/utils.ts");
    });

    it("detects multiple paths in one line", () => {
      const links = parseFileLinks("src/a.ts → src/b.ts");
      expect(links).toHaveLength(2);
      expect(links[0].path).toBe("src/a.ts");
      expect(links[1].path).toBe("src/b.ts");
    });

    it("ignores bare filenames without directory", () => {
      const links = parseFileLinks("error in foo.ts");
      expect(links).toHaveLength(0);
    });

    it("returns empty array for text with no paths", () => {
      const links = parseFileLinks("hello world 123");
      expect(links).toHaveLength(0);
    });
  });

  describe("line:col suffix — colon format", () => {
    it("detects :line", () => {
      const links = parseFileLinks("src/foo.ts:42");
      expect(links).toHaveLength(1);
      expect(links[0].path).toBe("src/foo.ts");
      expect(links[0].line).toBe(42);
      expect(links[0].col).toBeUndefined();
    });

    it("detects :line:col", () => {
      const links = parseFileLinks("src/foo.ts:42:10");
      expect(links).toHaveLength(1);
      expect(links[0].path).toBe("src/foo.ts");
      expect(links[0].line).toBe(42);
      expect(links[0].col).toBe(10);
    });
  });

  describe("line:col suffix — parenthesis format", () => {
    it("detects (line)", () => {
      const links = parseFileLinks("src/foo.ts(42)");
      expect(links).toHaveLength(1);
      expect(links[0].line).toBe(42);
      expect(links[0].col).toBeUndefined();
    });

    it("detects (line, col)", () => {
      const links = parseFileLinks("src/foo.ts(42, 10)");
      expect(links).toHaveLength(1);
      expect(links[0].line).toBe(42);
      expect(links[0].col).toBe(10);
    });

    it("detects (line,col) without space", () => {
      const links = parseFileLinks("src/foo.ts(42,10)");
      expect(links).toHaveLength(1);
      expect(links[0].line).toBe(42);
      expect(links[0].col).toBe(10);
    });
  });

  describe("line:col suffix — bracket format", () => {
    it("detects [line, col]", () => {
      const links = parseFileLinks("src/foo.ts[42, 10]");
      expect(links).toHaveLength(1);
      expect(links[0].line).toBe(42);
      expect(links[0].col).toBe(10);
    });

    it("detects [line]", () => {
      const links = parseFileLinks("src/foo.ts[42]");
      expect(links).toHaveLength(1);
      expect(links[0].line).toBe(42);
      expect(links[0].col).toBeUndefined();
    });
  });

  describe("position tracking", () => {
    it("reports correct startIndex", () => {
      const links = parseFileLinks("error in src/foo.ts:10");
      expect(links[0].startIndex).toBe(9); // "error in " = 9 chars
    });

    it("totalLength includes suffix", () => {
      const links = parseFileLinks("src/foo.ts:42:10");
      // "src/foo.ts" = 10, ":42:10" = 6
      expect(links[0].totalLength).toBe(16);
    });

    it("totalLength excludes suffix when none present", () => {
      const links = parseFileLinks("src/foo.ts is broken");
      expect(links[0].totalLength).toBe(10); // "src/foo.ts"
    });
  });

  describe("real-world terminal output", () => {
    it("vitest FAIL line", () => {
      const links = parseFileLinks(" FAIL  src/lib/__tests__/file-utils.test.ts > getAssistantCacheDir");
      expect(links).toHaveLength(1);
      expect(links[0].path).toBe("src/lib/__tests__/file-utils.test.ts");
    });

    it("TypeScript error", () => {
      const links = parseFileLinks("src/components/button.tsx(15,3): error TS2322: Type");
      expect(links).toHaveLength(1);
      expect(links[0].path).toBe("src/components/button.tsx");
      expect(links[0].line).toBe(15);
      expect(links[0].col).toBe(3);
    });

    it("ESLint warning", () => {
      const links = parseFileLinks("  ./src/hooks/use-theme.ts:23:5  warning  ...");
      expect(links).toHaveLength(1);
      expect(links[0].path).toBe("./src/hooks/use-theme.ts");
      expect(links[0].line).toBe(23);
      expect(links[0].col).toBe(5);
    });

    it("Rust compiler error", () => {
      const links = parseFileLinks("  --> src/main.rs:42:10");
      expect(links).toHaveLength(1);
      expect(links[0].path).toBe("src/main.rs");
      expect(links[0].line).toBe(42);
      expect(links[0].col).toBe(10);
    });

    it("deeply nested path", () => {
      const links = parseFileLinks("Modified: src/app/api/internal/assistant/images/route.ts");
      expect(links).toHaveLength(1);
      expect(links[0].path).toBe("src/app/api/internal/assistant/images/route.ts");
    });
  });
});
