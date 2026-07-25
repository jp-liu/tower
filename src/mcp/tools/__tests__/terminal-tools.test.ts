import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

// Mock db before any imports
vi.mock("../../db", () => ({
  db: {
    taskExecution: {
      findFirst: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// Mock the harness pending-ask lookup used by the send guardrail
vi.mock("@/lib/harness/harness-message", () => ({
  getOpenAsk: vi.fn(),
}));

// Mock global.fetch before any imports
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { db } from "../../db";
import { getOpenAsk } from "@/lib/harness/harness-message";
import { terminalTools } from "../terminal-tools";

const mockGetOpenAsk = getOpenAsk as ReturnType<typeof vi.fn>;

const mockDb = db as unknown as {
  taskExecution: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  task: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
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
    // Default: no pending ask, so the send guardrail is inert.
    mockGetOpenAsk.mockResolvedValue(null);
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
      const mockData = {
        executionId: "exec1",
        worktreePath: "/tmp/wt",
        connectionId: "connection-1",
        modelId: "model-1",
        targetId: "target-1",
      };
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

      expect(result).toMatchObject({
        ok: true,
        executionId: "exec1",
        worktreePath: "/tmp/wt",
        connectionId: "connection-1",
        modelId: "model-1",
        targetId: "target-1",
      });
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

      expect(result).toMatchObject({
        taskId: VALID_TASK_ID,
        lines: ["line1", "line2"],
        total: 2,
        killed: false,
      });
      // Server-rendered card shown to the user verbatim
      expect((result as { display?: string }).display).toContain(
        `📺 Terminal — ${VALID_TASK_ID} (2 total lines, showing last 2)`
      );
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
    it("POSTs to /{taskId}/input forwarding text + submit:true by default", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse(200, {}));

      const result = await terminalTools.send_task_terminal_input.handler({
        taskId: VALID_TASK_ID,
        text: "hello",
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain(`/api/internal/terminal/${VALID_TASK_ID}/input`);
      expect(init.method).toBe("POST");
      // The tool forwards the raw text + submit flag; the bridge route owns the CR logic.
      expect(JSON.parse(init.body)).toEqual({ text: "hello", submit: true });

      expect(result).toMatchObject({ ok: true, taskId: VALID_TASK_ID });
    });

    it("forwards the text untouched — newline normalization happens in the route", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse(200, {}));

      await terminalTools.send_task_terminal_input.handler({
        taskId: VALID_TASK_ID,
        text: "line1\nline2\n",
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ text: "line1\nline2\n", submit: true });
    });

    it("forwards submit:false so the route fills the box without submitting", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse(200, {}));

      await terminalTools.send_task_terminal_input.handler({
        taskId: VALID_TASK_ID,
        text: "hello\n",
        submit: false,
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ text: "hello\n", submit: false });
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

    it("redirects to reply_to_ask (does NOT send) when the task is parked on an ask", async () => {
      mockGetOpenAsk.mockResolvedValue({ id: "ask-1", content: "Which branch?" });

      const result = await terminalTools.send_task_terminal_input.handler({
        taskId: VALID_TASK_ID,
        text: "use main",
      });

      // The guardrail must short-circuit before touching the terminal bridge.
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        redirected: true,
        reason: "pending_ask",
        taskId: VALID_TASK_ID,
        requestId: "ask-1",
        question: "Which branch?",
      });
    });
  });

  describe("stop_task_execution", () => {
    it("returns error when neither taskId nor taskName is given", async () => {
      const result = await terminalTools.stop_task_execution.handler({});
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({ error: expect.stringContaining("Provide") });
    });

    it("returns error for invalid taskId without hitting the bridge", async () => {
      const result = await terminalTools.stop_task_execution.handler({ taskId: "nope" });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({ error: expect.stringContaining("Invalid taskId") });
    });

    it("returns 'Task not found' when taskId does not resolve", async () => {
      mockDb.task.findUnique.mockResolvedValue(null);
      const result = await terminalTools.stop_task_execution.handler({ taskId: VALID_TASK_ID });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({ error: "Task not found", taskId: VALID_TASK_ID });
    });

    it("stops by taskId and reports wasRunning from the bridge", async () => {
      mockDb.task.findUnique.mockResolvedValue({ id: VALID_TASK_ID, title: "Build feature" });
      mockFetch.mockResolvedValue(mockFetchResponse(200, { ok: true, wasRunning: true }));

      const result = await terminalTools.stop_task_execution.handler({ taskId: VALID_TASK_ID });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain(`/api/internal/terminal/${VALID_TASK_ID}/stop`);
      expect(init.method).toBe("POST");
      expect(result).toMatchObject({
        ok: true,
        taskId: VALID_TASK_ID,
        title: "Build feature",
        wasRunning: true,
        message: "Terminal closed",
      });
    });

    it("reports a no-op (success) when no terminal was running", async () => {
      mockDb.task.findUnique.mockResolvedValue({ id: VALID_TASK_ID, title: "Idle task" });
      mockFetch.mockResolvedValue(mockFetchResponse(200, { ok: true, wasRunning: false }));

      const result = await terminalTools.stop_task_execution.handler({ taskId: VALID_TASK_ID });

      expect(result).toMatchObject({
        ok: true,
        wasRunning: false,
        message: expect.stringContaining("nothing to close"),
      });
    });

    it("returns 'No task found' when name search is empty", async () => {
      mockDb.task.findMany.mockResolvedValue([]);
      const result = await terminalTools.stop_task_execution.handler({ taskName: "ghost" });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({ error: expect.stringContaining("No task found"), taskName: "ghost" });
    });

    it("stops directly on a unique fuzzy name match", async () => {
      mockDb.task.findMany.mockResolvedValue([
        {
          id: VALID_TASK_ID,
          title: "Migrate auth module",
          status: "IN_PROGRESS",
          project: { name: "Tower", workspace: { name: "Main" } },
        },
      ]);
      mockFetch.mockResolvedValue(mockFetchResponse(200, { ok: true, wasRunning: true }));

      const result = await terminalTools.stop_task_execution.handler({ taskName: "auth" });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain(`/api/internal/terminal/${VALID_TASK_ID}/stop`);
      expect(result).toMatchObject({ ok: true, taskId: VALID_TASK_ID, title: "Migrate auth module" });
    });

    it("returns candidates (needsSelection) without stopping on an ambiguous name", async () => {
      mockDb.task.findMany.mockResolvedValue([
        { id: "caaaaaaaaaaaaaaaaaaaaaaaaa", title: "Fix login bug", status: "IN_PROGRESS", project: { name: "P1", workspace: { name: "W" } } },
        { id: "cbbbbbbbbbbbbbbbbbbbbbbbbb", title: "Fix login redirect", status: "TODO", project: { name: "P2", workspace: { name: "W" } } },
      ]);

      const result = await terminalTools.stop_task_execution.handler({ taskName: "login" }) as {
        needsSelection: boolean;
        candidates: { taskId: string; title: string; status: string; project: string }[];
      };

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.needsSelection).toBe(true);
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0]).toMatchObject({ taskId: "caaaaaaaaaaaaaaaaaaaaaaaaa", title: "Fix login bug", status: "IN_PROGRESS", project: "P1" });
    });

    it("disambiguates multiple fuzzy matches via a single exact title match", async () => {
      mockDb.task.findMany.mockResolvedValue([
        { id: "caaaaaaaaaaaaaaaaaaaaaaaaa", title: "Deploy", status: "IN_PROGRESS", project: { name: "P1", workspace: { name: "W" } } },
        { id: "cbbbbbbbbbbbbbbbbbbbbbbbbb", title: "Deploy staging", status: "TODO", project: { name: "P2", workspace: { name: "W" } } },
      ]);
      mockFetch.mockResolvedValue(mockFetchResponse(200, { ok: true, wasRunning: false }));

      const result = await terminalTools.stop_task_execution.handler({ taskName: "deploy" });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/caaaaaaaaaaaaaaaaaaaaaaaaa/stop");
      expect(result).toMatchObject({ ok: true, taskId: "caaaaaaaaaaaaaaaaaaaaaaaaa" });
    });
  });

  describe("resume_task_execution", () => {
    it("returns error when neither taskId nor taskName is given", async () => {
      const result = await terminalTools.resume_task_execution.handler({});
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({ error: expect.stringContaining("Provide") });
    });

    it("returns 'Task not found' when taskId does not resolve", async () => {
      mockDb.task.findUnique.mockResolvedValue(null);
      const result = await terminalTools.resume_task_execution.handler({ taskId: VALID_TASK_ID });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({ error: "Task not found", taskId: VALID_TASK_ID });
    });

    it("launches by taskId, POSTs to /resume and reports the mode", async () => {
      mockDb.task.findUnique.mockResolvedValue({ id: VALID_TASK_ID, title: "Notify B" });
      mockFetch.mockResolvedValue(
        mockFetchResponse(200, {
          ok: true,
          mode: "continued",
          executionId: "exec9",
          worktreePath: "/tmp/wt",
          connectionId: "connection-9",
          modelId: "model-9",
          targetId: "target-9",
        })
      );

      const result = await terminalTools.resume_task_execution.handler({ taskId: VALID_TASK_ID });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain(`/api/internal/terminal/${VALID_TASK_ID}/resume`);
      expect(init.method).toBe("POST");
      expect(result).toMatchObject({
        ok: true,
        taskId: VALID_TASK_ID,
        title: "Notify B",
        mode: "continued",
        executionId: "exec9",
        worktreePath: "/tmp/wt",
        connectionId: "connection-9",
        modelId: "model-9",
        targetId: "target-9",
        message: "Terminal resumed from latest history",
      });
    });

    it("reports a no-op when the terminal is already running", async () => {
      mockDb.task.findUnique.mockResolvedValue({ id: VALID_TASK_ID, title: "Already up" });
      mockFetch.mockResolvedValue(
        mockFetchResponse(200, { ok: true, mode: "already_running", executionId: "exec1", worktreePath: null })
      );

      const result = await terminalTools.resume_task_execution.handler({ taskId: VALID_TASK_ID });

      expect(result).toMatchObject({
        ok: true,
        mode: "already_running",
        message: expect.stringContaining("already running"),
      });
    });

    it("reports a fresh start for a task with no history", async () => {
      mockDb.task.findUnique.mockResolvedValue({ id: VALID_TASK_ID, title: "First run" });
      mockFetch.mockResolvedValue(
        mockFetchResponse(200, { ok: true, mode: "started", executionId: "exec2", worktreePath: null })
      );

      const result = await terminalTools.resume_task_execution.handler({ taskId: VALID_TASK_ID });

      expect(result).toMatchObject({ ok: true, mode: "started", message: "Terminal started fresh" });
    });

    it("launches directly on a unique fuzzy name match", async () => {
      mockDb.task.findMany.mockResolvedValue([
        {
          id: VALID_TASK_ID,
          title: "Build pipeline",
          status: "TODO",
          project: { name: "Tower", workspace: { name: "Main" } },
        },
      ]);
      mockFetch.mockResolvedValue(mockFetchResponse(200, { ok: true, mode: "started", executionId: "e", worktreePath: null }));

      const result = await terminalTools.resume_task_execution.handler({ taskName: "pipeline" });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain(`/api/internal/terminal/${VALID_TASK_ID}/resume`);
      expect(result).toMatchObject({ ok: true, taskId: VALID_TASK_ID, title: "Build pipeline" });
    });

    it("returns candidates (needsSelection) without launching on an ambiguous name", async () => {
      mockDb.task.findMany.mockResolvedValue([
        { id: "caaaaaaaaaaaaaaaaaaaaaaaaa", title: "Sync data up", status: "TODO", project: { name: "P1", workspace: { name: "W" } } },
        { id: "cbbbbbbbbbbbbbbbbbbbbbbbbb", title: "Sync data down", status: "TODO", project: { name: "P2", workspace: { name: "W" } } },
      ]);

      const result = await terminalTools.resume_task_execution.handler({ taskName: "sync" }) as {
        needsSelection: boolean;
        candidates: unknown[];
      };

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.needsSelection).toBe(true);
      expect(result.candidates).toHaveLength(2);
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
        connectionId: "connection-1",
        modelId: "model-1",
        targetId: "target-1",
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
        connectionId: "connection-1",
        modelId: "model-1",
        targetId: "target-1",
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
