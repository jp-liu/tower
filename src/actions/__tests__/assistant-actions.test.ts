import { describe, it } from "vitest";

describe("assistant-actions", () => {
  describe("startAssistantSession", () => {
    it.todo("creates a PTY session keyed by __assistant__ (BE-01)");
    it.todo("includes --allowedTools mcp__tower__* in CLI args (BE-03)");
    it.todo("includes --append-system-prompt with configured prompt (BE-02)");
    it.todo("destroys existing session before creating new one (UX-01)");
    it.todo("throws if no default CliProfile exists");
  });

  describe("stopAssistantSession", () => {
    it.todo("destroys the __assistant__ session (BE-05)");
  });

  describe("getAssistantSessionStatus", () => {
    it.todo("returns 'idle' when no session exists");
    it.todo("returns 'running' when session is active");
  });
});
