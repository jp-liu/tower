import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

// Mock db before any imports
vi.mock("../../db", () => ({
  db: {
    taskExecution: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock global.fetch before any imports
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { db } from "../../db";
import { terminalTools } from "../terminal-tools";

const mockDb = db as {
  taskExecution: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

// Helper to create mock fetch response
function mockFetchResponse(status: number, data: unknown): Response {
  return {
    ok: status >= 200 && status < 400,
    status,
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

// Valid CUID-format task ID for tests
const VALID_TASK_ID = "cjldlkfxz0000ld08001abcde";

describe("terminal-tools", () => {
  beforeAll(() => {
    // Ensure PORT is set for bridge URL
    process.env.PORT = "3000";
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("CUID validation", () => {
    it("returns error immediately for invalid taskId without calling fetch", async () => {
      const result = await terminalTools.get_task_terminal_output.handler({ taskId: "invalid" });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        error: expect.stringContaining("Invalid taskId"),
        taskId: "invalid",
      });
    });

    it("returns error for numeric-looking taskId", async () => {
      const result = await terminalTools.get_task_terminal_output.handler({ taskId: "12345" });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({ error: expect.stringContaining("Invalid taskId") });
    });

    it("returns error for taskId with hyphens (not CUID format)", async () => {
      const result = await terminalTools.send_task_terminal_input.handler({
        taskId: "not-a-cuid-format",
        text: "hello",
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({ error: expect.stringContaining("Invalid taskId") });
    });
  });

  describe("start_task_execution", () => {
    it("POSTs to /{taskId}/start and returns ok: true with merged data on success", async () => {
      const mockData = { executionId: "exec1", worktreePath: "/tmp/wt" };
      mockFetch.mockResolvedValue(mockFetchResponse(200, mockData));

      const result = await terminalTools.start_task_execution.handler({
        taskId: VALID_TASK_ID,
        prompt: "do something",
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain(`/api/internal/terminal/${VALID_TASK_ID}/start`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ prompt: "do something" });

      expect(result).toMatchObject({ ok: true, executionId: "exec1", worktreePath: "/tmp/wt" });
    });

    it("returns error with status on non-ok response", async () => {
      const errData = { error: "Task not found" };
      mockFetch.mockResolvedValue(mockFetchResponse(404, errData));

      const result = await terminalTools.start_task_execution.handler({
        taskId: VALID_TASK_ID,
        prompt: "do something",
      });

      expect(result).toMatchObject({ error: "Task not found", status: 404 });
    });

    it("uses empty string as default prompt when not provided", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse(200, { executionId: "exec1" }));

      await terminalTools.start_task_execution.handler({ taskId: VALID_TASK_ID });

      const [, init] = mockFetch.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ prompt: "" });
    });
  });

  describe("get_task_terminal_output", () => {
    it("GETs /{taskId}/buffer?lines=N and returns lines/total/killed on 200", async () => {
      const mockData = {
        taskId: VALID_TASK_ID,
        lines: ["line1", "line2"],
        total: 2,
        killed: false,
      };
      mockFetch.mockResolvedValue(mockFetchResponse(200, mockData));

      const result = await terminalTools.get_task_terminal_output.handler({
        taskId: VALID_TASK_ID,
        lines: 20,
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain(`/api/internal/terminal/${VALID_TASK_ID}/buffer?lines=20`);

      expect(result).toEqual({
        taskId: VALID_TASK_ID,
        lines: ["line1", "line2"],
        total: 2,
        killed: false,
      });
    });

    it("returns 'No active terminal session' error on 404", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse(404, {}));

      const result = await terminalTools.get_task_terminal_output.handler({
        taskId: VALID_TASK_ID,
        lines: 10,
      });

      expect(result).toMatchObject({
        error: "No active terminal session for this task",
        taskId: VALID_TASK_ID,
      });
    });

    it("uses default lines=50 when lines param not provided", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse(200, { taskId: VALID_TASK_ID, lines: [], total: 0, killed: false })
      );

      await terminalTools.get_task_terminal_output.handler({ taskId: VALID_TASK_ID });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("buffer?lines=50");
    });
  });

  describe("send_task_terminal_input", () => {
    it("POSTs to /{taskId}/input with text body and returns ok: true on success", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse(200, {}));

      const result = await terminalTools.send_task_terminal_input.handler({
        taskId: VALID_TASK_ID,
        text: "hello\n",
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain(`/api/internal/terminal/${VALID_TASK_ID}/input`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ text: "hello\n" });

      expect(result).toMatchObject({ ok: true, taskId: VALID_TASK_ID });
    });

    it("returns 'No active terminal session' error on 404", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse(404, {}));

      const result = await terminalTools.send_task_terminal_input.handler({
        taskId: VALID_TASK_ID,
        text: "hello",
      });

      expect(result).toMatchObject({
        error: "No active terminal session for this task",
        taskId: VALID_TASK_ID,
      });
    });

    it("returns 'Terminal session has exited' error on 410", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse(410, {}));

      const result = await terminalTools.send_task_terminal_input.handler({
        taskId: VALID_TASK_ID,
        text: "hello",
      });

      expect(result).toMatchObject({
        error: "Terminal session has exited",
        taskId: VALID_TASK_ID,
      });
    });
  });

  describe("get_task_execution_status", () => {
    it("returns error when no execution found in db", async () => {
      mockDb.taskExecution.findFirst.mockResolvedValue(null);

      const result = await terminalTools.get_task_execution_status.handler({
        taskId: VALID_TASK_ID,
      });

      expect(result).toMatchObject({
        error: "No execution found for this task",
        taskId: VALID_TASK_ID,
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns terminalStatus=exited when buffer returns 404 and execution is COMPLETED", async () => {
      mockDb.taskExecution.findFirst.mockResolvedValue({
        id: "exec1",
        status: "COMPLETED",
        startedAt: null,
        endedAt: null,
      });
      mockFetch.mockResolvedValue(mockFetchResponse(404, {}));

      const result = await terminalTools.get_task_execution_status.handler({
        taskId: VALID_TASK_ID,
      });

      expect(result).toMatchObject({
        taskId: VALID_TASK_ID,
        executionId: "exec1",
        executionStatus: "COMPLETED",
        terminalStatus: "exited",
        outputSnippet: null,
      });
    });

    it("returns terminalStatus=not_running when buffer returns 404 and execution is RUNNING", async () => {
      mockDb.taskExecution.findFirst.mockResolvedValue({
        id: "exec1",
        status: "RUNNING",
        startedAt: null,
        endedAt: null,
      });
      mockFetch.mockResolvedValue(mockFetchResponse(404, {}));

      const result = await terminalTools.get_task_execution_status.handler({
        taskId: VALID_TASK_ID,
      });

      expect(result).toMatchObject({
        terminalStatus: "not_running",
      });
    });

    it("returns terminalStatus=exited when buffer is ok and killed=true", async () => {
      mockDb.taskExecution.findFirst.mockResolvedValue({
        id: "exec1",
        status: "RUNNING",
        startedAt: null,
        endedAt: null,
      });
      mockFetch.mockResolvedValue(
        mockFetchResponse(200, { lines: ["done"], killed: true })
      );

      const result = await terminalTools.get_task_execution_status.handler({
        taskId: VALID_TASK_ID,
      });

      expect(result).toMatchObject({
        terminalStatus: "exited",
        outputSnippet: "done",
      });
    });

    it("returns terminalStatus=running with outputSnippet when buffer is ok and killed=false", async () => {
      mockDb.taskExecution.findFirst.mockResolvedValue({
        id: "exec1",
        status: "RUNNING",
        startedAt: null,
        endedAt: null,
      });
      mockFetch.mockResolvedValue(
        mockFetchResponse(200, { lines: ["line1", "line2", "line3"], killed: false })
      );

      const result = await terminalTools.get_task_execution_status.handler({
        taskId: VALID_TASK_ID,
      });

      expect(result).toMatchObject({
        terminalStatus: "running",
        outputSnippet: "line1\nline2\nline3",
      });

      // Verify bridge fetch was called with buffer?lines=10
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain(`/api/internal/terminal/${VALID_TASK_ID}/buffer?lines=10`);
    });
  });
});
