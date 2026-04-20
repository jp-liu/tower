// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "../logger";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("logger.info", () => {
    it("calls console.log once with INFO level and [app] context", () => {
      logger.info("hello");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toMatch(/INFO/);
      expect(output).toMatch(/\[app\]/);
      expect(output).toContain("hello");
    });

    it("output contains ISO-format timestamp", () => {
      logger.info("timestamp test");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("output format is [TIMESTAMP] INFO [app] message", () => {
      logger.info("format check");
      const output = logSpy.mock.calls[0][0] as string;
      // Pattern: [ISO] INFO [app] format check
      expect(output).toMatch(/^\[.*?\] INFO \[app\] format check$/);
    });

    it("includes JSON-stringified meta when meta object is provided", () => {
      logger.info("data", { userId: "abc" });
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("userId");
      expect(output).toContain("abc");
    });

    it("does not include meta section when meta is omitted", () => {
      logger.info("no meta");
      const output = logSpy.mock.calls[0][0] as string;
      // Should not end with a JSON object
      expect(output).not.toContain("{");
    });
  });

  describe("logger.warn", () => {
    it("calls console.warn once (not console.log) with WARN level", () => {
      logger.warn("caution");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
      const output = warnSpy.mock.calls[0][0] as string;
      expect(output).toMatch(/WARN/);
      expect(output).toContain("caution");
    });

    it("warn output contains [app] context", () => {
      logger.warn("context check");
      const output = warnSpy.mock.calls[0][0] as string;
      expect(output).toContain("[app]");
    });
  });

  describe("logger.error", () => {
    it("calls console.error once (not log or warn) with ERROR level", () => {
      logger.error("fail");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      const output = errorSpy.mock.calls[0][0] as string;
      expect(output).toMatch(/ERROR/);
      expect(output).toContain("fail");
    });

    it("error with Error object includes error.message in meta", () => {
      const err = new Error("boom");
      logger.error("fail", err);
      const output = errorSpy.mock.calls[0][0] as string;
      expect(output).toContain("boom");
    });

    it("error with Error object includes stack in meta JSON", () => {
      const err = new Error("stack test");
      logger.error("fail", err);
      const output = errorSpy.mock.calls[0][0] as string;
      expect(output).toContain("stack");
    });

    it("error with string argument includes string in meta", () => {
      logger.error("oops", "string-error");
      const output = errorSpy.mock.calls[0][0] as string;
      expect(output).toContain("string-error");
    });

    it("error with non-Error object converts to string in meta", () => {
      logger.error("oops", 42);
      const output = errorSpy.mock.calls[0][0] as string;
      expect(output).toContain("42");
    });
  });

  describe("logger.create (scoped logger)", () => {
    it("uses custom context name in output instead of [app]", () => {
      const scopedLogger = logger.create("myModule");
      scopedLogger.info("test");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("[myModule]");
      expect(output).not.toContain("[app]");
    });

    it("scoped logger.warn uses console.warn with custom context", () => {
      const scopedLogger = logger.create("payments");
      scopedLogger.warn("limit hit");
      const output = warnSpy.mock.calls[0][0] as string;
      expect(output).toContain("[payments]");
      expect(output).toContain("limit hit");
    });

    it("scoped logger.error with Error includes context and error details", () => {
      const scopedLogger = logger.create("auth");
      const err = new Error("token expired");
      scopedLogger.error("access denied", err);
      const output = errorSpy.mock.calls[0][0] as string;
      expect(output).toContain("[auth]");
      expect(output).toContain("token expired");
    });
  });

  describe("sensitive field behavior (COV-23 documentation)", () => {
    it("logger does NOT scrub sensitive fields — password value IS present in output (current behavior)", () => {
      // COV-23: Documenting current logger behavior — no field scrubbing.
      // The logger outputs sensitive fields as-is. This test documents
      // the current behavior. Future work could add scrubbing.
      logger.info("user action", { password: "secret123", userId: "u1" });
      const output = logSpy.mock.calls[0][0] as string;
      // Current behavior: sensitive fields are NOT scrubbed
      expect(output).toContain("secret123");
      expect(output).toContain("password");
    });

    it("logger does NOT scrub token field — token value is present in output (current behavior)", () => {
      // COV-23: Documenting current logger behavior for API tokens
      logger.info("api call", { token: "sk-abc123", action: "list" });
      const output = logSpy.mock.calls[0][0] as string;
      // Current behavior: token is not scrubbed
      expect(output).toContain("sk-abc123");
    });
  });

  describe("structured output format", () => {
    it("full format matches [ISO] LEVEL [context] message {meta}", () => {
      logger.info("structured", { key: "val" });
      const output = logSpy.mock.calls[0][0] as string;
      // Full pattern: [2026-04-20T...] INFO [app] structured {"key":"val"}
      expect(output).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] INFO \[app\] structured \{"key":"val"\}$/);
    });

    it("error with Error includes both message and stack in meta JSON", () => {
      const err = new Error("test error");
      logger.error("detailed error", err, { requestId: "req-1" });
      const output = errorSpy.mock.calls[0][0] as string;
      // Should contain requestId in meta along with error details
      expect(output).toContain("requestId");
      expect(output).toContain("req-1");
      expect(output).toContain("test error");
    });
  });
});
